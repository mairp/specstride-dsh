/**
 * The host CLI runs from the packed package (fix 2026-11-09). The package
 * ships only `bin/` and `skills/` (T027), so `doctor`, `install` and
 * `uninstall` must run from `bin/lib/` — compiled by
 * `scripts/build-host-cli.ts` — with no `src/`, `contracts/` or `tests/`
 * beside them, and the committed `bin/lib/` must be what the build writes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildHostCli } from "../../scripts/build-host-cli.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NPM = (() => {
  const candidate = join(dirname(dirname(process.execPath)), "lib", "node_modules", "npm", "bin", "npm-cli.js");
  return existsSync(candidate) ? candidate : (process.env.npm_execpath ?? "npm");
})();

function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort();
}

test("the committed bin/lib is exactly what the build writes", () => {
  const out = mkdtempSync(join(tmpdir(), "host-cli-"));
  try {
    buildHostCli(out);
    const committed = join(ROOT, "bin", "lib");
    assert.deepEqual(listFiles(committed), listFiles(out));
    for (const file of listFiles(out)) {
      assert.equal(readFileSync(join(committed, file), "utf8"), readFileSync(join(out, file), "utf8"), `bin/lib/${file} is stale: run npm run build`);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("doctor, install and uninstall run from the packed tarball; eval refuses in one line", () => {
  const work = mkdtempSync(join(tmpdir(), "packed-cli-"));
  try {
    const packed = JSON.parse(execFileSync(process.execPath, [NPM, "pack", "--json", "--pack-destination", work], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })) as { filename: string }[];
    const modules = join(work, "node_modules", "@specstride");
    mkdirSync(modules, { recursive: true });
    execFileSync("tar", ["-xzf", join(work, packed[0]!.filename), "-C", work]);
    execFileSync("mv", [join(work, "package"), join(modules, "host-dsh")]);
    for (const dep of ["host-kit", "contracts"]) symlinkSync(realpathSync(join(ROOT, "node_modules", "@specstride", dep)), join(modules, dep));
    const pkg = join(modules, "host-dsh");
    assert.ok(!existsSync(join(pkg, "src")) && !existsSync(join(pkg, "contracts")), "the package ships no src/ and no contracts/");
    const cli = join(pkg, "bin", "specstride-host-dsh.mjs");
    const project = join(work, "project");
    mkdirSync(project);
    const env = { PATH: "", HOME: project, PROJECT_ROOT: project };

    const doctor = spawnSync(process.execPath, [cli, "doctor"], { cwd: project, env, encoding: "utf8" });
    assert.match(doctor.stdout, /^fail host\.cli-found — /m, doctor.stderr);
    assert.match(doctor.stdout, /host\.protocol-supported/);

    const install = spawnSync(process.execPath, [cli, "install", "--project"], { cwd: project, env, encoding: "utf8" });
    assert.equal(install.status, 0, install.stderr);
    for (const skill of ["specstride-run", "specstride-reverse", "specstride-doctor"]) {
      assert.ok(existsSync(join(project, ".dsh", "skills", skill, "SKILL.md")), `${skill} installed`);
    }
    const uninstall = spawnSync(process.execPath, [cli, "uninstall", "--project"], { cwd: project, env, encoding: "utf8" });
    assert.equal(uninstall.status, 0, uninstall.stderr);
    assert.ok(!existsSync(join(project, ".dsh", "skills", "specstride-run")), "uninstalled");

    const lane = spawnSync(process.execPath, [cli, "eval"], { cwd: project, env, encoding: "utf8" });
    assert.equal(lane.status, 2);
    assert.match(lane.stderr, /runs from a repository checkout/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
