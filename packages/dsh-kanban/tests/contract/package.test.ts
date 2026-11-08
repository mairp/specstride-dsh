/**
 * T019 — PT-121-001 (F121-FR-001): the package manifest per
 * contracts/plugin-package.md: the manifest fields exactly; the peer at the root
 * package's exact version; no runtime dependency; the contracts dev dependency is
 * the pinned tarball; `npm pack --dry-run --json` lists only `lib/`,
 * `cordis.patch.yml`, `package.json`; and no file of `lib/` byte-equals or embeds
 * a file of the four pinned engine tarballs (120's no-copy check).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildKanban } from "../../scripts/build-kanban.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const repoRoot = join(packageRoot, "..", "..");
const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as Record<string, unknown>;
const rootPkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as Record<string, unknown>;

test("the manifest fields follow contracts/plugin-package.md", () => {
  assert.equal(pkg.name, "@specstride/dsh-kanban");
  assert.equal(typeof pkg.version, "string");
  assert.equal(pkg.type, "module");
  assert.equal(pkg.license, "Apache-2.0");
  assert.equal((pkg.engines as Record<string, string>).node, ">=22.13");
  assert.deepEqual(pkg.dsh, {
    bundle: { patch: "./cordis.patch.yml" },
    client: { platform: "web", inject: ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-ui-conversation"] },
  });
  assert.deepEqual(pkg.exports, {
    "./client": "./lib/client.js",
    "./server": "./lib/server/entry.js",
    "./package.json": "./package.json",
  });
  assert.deepEqual(pkg.files, ["lib/", "cordis.patch.yml"]);
});

test("the peer is the root package's exact version; no runtime dependency; the contracts dev dependency is the pinned tarball", () => {
  assert.deepEqual(pkg.peerDependencies, { "@specstride/host-dsh": rootPkg.version });
  const dependencies = (pkg.dependencies ?? {}) as Record<string, string>;
  assert.deepEqual(Object.keys(dependencies), [], "no runtime dependencies");
  assert.equal(
    (pkg.devDependencies as Record<string, string>)["@specstride/contracts"],
    "file:../../vendor/core/specstride-contracts-0.1.0.tgz",
  );
  const scripts = (pkg.scripts ?? {}) as Record<string, string>;
  for (const forbidden of ["preinstall", "install", "postinstall", "prepare"]) {
    assert.equal(forbidden in scripts, false, `no ${forbidden} script`);
  }
});

test("npm pack --dry-run --json lists only lib/, cordis.patch.yml and package.json", () => {
  buildKanban(); // the pack is of the built package; the build is deterministic and idempotent
  const output = execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: packageRoot, encoding: "utf8" });
  const data = JSON.parse(output) as { name: string; files: { path: string }[] }[];
  const entry = data.find((item) => item.name === "@specstride/dsh-kanban");
  assert.ok(entry, "the dry run describes this package");
  const paths = entry!.files.map((file) => file.path).sort();
  assert.ok(paths.includes("package.json"));
  assert.ok(paths.includes("cordis.patch.yml"));
  assert.ok(paths.some((path) => path.startsWith("lib/")));
  for (const path of paths) {
    assert.ok(path === "package.json" || path === "cordis.patch.yml" || path.startsWith("lib/"), path);
  }
});

const ENGINE_TARBALLS = [
  "specstride-0.1.0.tgz",
  "specstride-contracts-0.1.0.tgz",
  "specstride-host-kit-0.1.0.tgz",
  "specstride-testkit-0.1.0.tgz",
];

function hashOf(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function libFiles(): { path: string; data: Buffer }[] {
  const files: { path: string; data: Buffer }[] = [];
  for (const entry of readdirSync(join(packageRoot, "lib"), { recursive: true, withFileTypes: true }) as import("node:fs").Dirent[]) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files.push({ path: path.slice(packageRoot.length + 1), data: readFileSync(path) });
  }
  assert.ok(files.length > 0, "lib/ is built");
  return files;
}

function engineFiles(): { path: string; data: Buffer }[] {
  const into = mkdtempSync(join(tmpdir(), "kanban-t019-engines-"));
  const files: { path: string; data: Buffer }[] = [];
  try {
    for (const tarball of ENGINE_TARBALLS) {
      const target = join(into, tarball.replace(/\.tgz$/, ""));
      mkdirSync(target, { recursive: true });
      execFileSync("tar", ["-xzf", join(repoRoot, "vendor", "core", tarball)], { cwd: target });
      for (const entry of readdirSync(target, { recursive: true, withFileTypes: true }) as import("node:fs").Dirent[]) {
        if (!entry.isFile()) continue;
        const path = join(entry.parentPath, entry.name);
        files.push({ path: `${tarball}:${path.slice(target.length + 1)}`, data: readFileSync(path) });
      }
    }
  } finally {
    rmSync(into, { recursive: true, force: true });
  }
  return files;
}

test("no file of lib/ byte-equals or embeds a file of the pinned engine tarballs", () => {
  buildKanban();
  const engines = engineFiles().filter((file) => file.data.length <= 8 * 1024 * 1024);
  const engineHashes = new Set(engines.map((file) => hashOf(file.data)));
  const engineBuffers = engines.map((file) => file.data);
  for (const file of libFiles()) {
    assert.ok(!engineHashes.has(hashOf(file.data)), `${file.path} byte-equals an engine file`);
    for (const engine of engineBuffers) {
      assert.ok(!file.data.includes(engine), `${file.path} embeds an engine file (${engine.length} bytes)`);
    }
  }
});

test("the engine tarballs are the four pinned ones, all readable", () => {
  for (const tarball of ENGINE_TARBALLS) {
    assert.equal(statSync(join(repoRoot, "vendor", "core", tarball)).size > 0, true, tarball);
  }
});
