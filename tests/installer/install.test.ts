/**
 * T024 — the installer lifecycle test (PT-120-020; F120-FR-020).
 *
 * Every case runs ONLY against a temporary `DSH_HOME` and a temporary
 * project root — never the user's real skill root (F120-FR-020). The CLI is
 * driven through the shipped bin; each assertion observes the resulting file
 * state through an independent read path (effect witness), not through the
 * installer's own response.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(ROOT, "bin", "specstride-host-dsh.mjs");
const RECORD = ".specstride-host-dsh-install.json";
const SPELLINGS = ["specstride-run", "specstride-reverse", "specstride-doctor"];
const MANIFEST = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  name: string;
  version: string;
  specstride?: { engineVersion?: string };
};

function sha256Of(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function tempRoot(label: string): string {
  return mkdtempSync(join(tmpdir(), `dsh-install-${label}-`));
}

function run(
  args: readonly string[],
  env: Record<string, string>,
): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status: number; stdout: string; stderr: string };
    return {
      code: failure.status ?? 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

/** A hermetic environment: temp DSH_HOME, temp project root, temp HOME. */
function hermetic(): { env: Record<string, string>; dshHome: string; project: string; home: string } {
  const dshHome = tempRoot("home");
  const project = tempRoot("project");
  const home = tempRoot("shared");
  return {
    env: { DSH_HOME: dshHome, PROJECT_ROOT: project, HOME: home },
    dshHome,
    project,
    home,
  };
}

function userRoot(env: { DSH_HOME: string }): string {
  return join(env.DSH_HOME, "skills");
}

function snapshot(root: string): Map<string, string> {
  const bytes = new Map<string, string>();
  if (!existsSync(root)) return bytes;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else bytes.set(path, sha256Of(path));
    }
  };
  walk(root);
  return bytes;
}

test("default scope user writes exactly three skill directories plus the record under $DSH_HOME/skills", () => {
  const herm = hermetic();
  try {
    const result = run(["install"], herm.env);
    assert.equal(result.code, 0, result.stderr);
    const root = userRoot(herm.env);
    assert.deepEqual(
      readdirSync(root).sort(),
      [...SPELLINGS, RECORD].sort(),
      "exactly the three skill directories plus the record",
    );
    for (const spelling of SPELLINGS) {
      const skillMd = join(root, spelling, "SKILL.md");
      assert.ok(existsSync(skillMd), `${spelling}/SKILL.md installed`);
      assert.match(readFileSync(skillMd, "utf8"), /^metadata:\n  version: /m);
    }
    const record = JSON.parse(readFileSync(join(root, RECORD), "utf8")) as {
      package: { name: string; version: string };
      engineVersion: string;
      kitVersion: string;
      scope: string;
      root: string;
      skills: Record<string, { directory: string; contentHash: string; files: { path: string; sha256: string }[] }>;
    };
    assert.deepEqual(record.package, { name: MANIFEST.name, version: MANIFEST.version });
    assert.equal(record.engineVersion, MANIFEST.specstride!.engineVersion!);
    assert.equal(typeof record.kitVersion, "string");
    assert.notEqual(record.kitVersion, "");
    assert.equal(record.scope, "user");
    assert.equal(record.root, root);
    assert.deepEqual(Object.keys(record.skills).sort(), ["doctor", "specstride-reverse", "specstride-run"]);
    for (const spelling of SPELLINGS) {
      const row = record.skills[spelling === "specstride-doctor" ? "doctor" : spelling];
      assert.equal(row.directory, spelling);
      assert.match(row.contentHash, /^[0-9a-f]{64}$/);
      const files = row.files.map((file) => file.path);
      assert.ok(files.includes(`${spelling}/SKILL.md`));
      for (const file of row.files) {
        assert.equal(file.sha256, sha256Of(join(root, file.path)), `${file.path} sha256 recorded`);
      }
    }
  } finally {
    rmSync(herm.dshHome, { recursive: true, force: true });
    rmSync(herm.project, { recursive: true, force: true });
    rmSync(herm.home, { recursive: true, force: true });
  }
});

test("a second run changes no byte (idempotent)", () => {
  const herm = hermetic();
  try {
    assert.equal(run(["install"], herm.env).code, 0);
    const root = userRoot(herm.env);
    const before = snapshot(root);
    const second = run(["install"], herm.env);
    assert.equal(second.code, 0, second.stderr);
    assert.match(second.stdout + second.stderr, /already installed, unchanged/);
    const after = snapshot(root);
    assert.deepEqual([...after.entries()].sort(), [...before.entries()].sort(), "no byte changed");
  } finally {
    rmSync(herm.dshHome, { recursive: true, force: true });
    rmSync(herm.project, { recursive: true, force: true });
    rmSync(herm.home, { recursive: true, force: true });
  }
});

test("--project targets <projectRoot>/.dsh/skills; --shared targets ~/.agents/skills", () => {
  const herm = hermetic();
  try {
    assert.equal(run(["install", "--project"], herm.env).code, 0);
    assert.deepEqual(
      readdirSync(join(herm.project, ".dsh", "skills")).sort(),
      [...SPELLINGS, RECORD].sort(),
    );
    assert.equal(
      (JSON.parse(readFileSync(join(herm.project, ".dsh", "skills", RECORD), "utf8")) as { scope: string }).scope,
      "project",
    );
    assert.equal(run(["install", "--shared"], herm.env).code, 0);
    assert.deepEqual(
      readdirSync(join(herm.home, ".agents", "skills")).sort(),
      [...SPELLINGS, RECORD].sort(),
    );
    assert.equal(
      (JSON.parse(readFileSync(join(herm.home, ".agents", "skills", RECORD), "utf8")) as { scope: string }).scope,
      "shared",
    );
  } finally {
    rmSync(herm.dshHome, { recursive: true, force: true });
    rmSync(herm.project, { recursive: true, force: true });
    rmSync(herm.home, { recursive: true, force: true });
  }
});

test("an unknown scope refuses with one line", () => {
  const herm = hermetic();
  try {
    for (const args of [["install", "--scope=global"], ["install", "--project", "--shared"]]) {
      const result = run(args, herm.env);
      assert.notEqual(result.code, 0, args.join(" "));
      const lines = result.stderr.trim().split("\n");
      assert.equal(lines.length, 1, `one line, got: ${result.stderr}`);
      assert.match(lines[0], /refus|scope/i);
    }
    assert.equal(existsSync(userRoot(herm.env)), false, "nothing written");
  } finally {
    rmSync(herm.dshHome, { recursive: true, force: true });
    rmSync(herm.project, { recursive: true, force: true });
    rmSync(herm.home, { recursive: true, force: true });
  }
});

test("a target directory the installer did not write is refused with one line and nothing is written", () => {
  const herm = hermetic();
  try {
    const root = userRoot(herm.env);
    // A foreign skill directory with a colliding name, no record anywhere.
    const foreign = join(root, "specstride-run");
    mkdirSync(foreign, { recursive: true });
    writeFileSync(join(foreign, "SKILL.md"), "---\nname: specstride-run\n---\nforeign\n");
    const before = snapshot(root);
    const result = run(["install"], herm.env);
    assert.notEqual(result.code, 0);
    const lines = result.stderr.trim().split("\n");
    assert.equal(lines.length, 1, `one line, got: ${result.stderr}`);
    assert.match(lines[0], /specstride-run/);
    assert.match(lines[0], /no record/);
    assert.deepEqual([...snapshot(root).entries()].sort(), [...before.entries()].sort(), "nothing written");
    assert.equal(existsSync(join(root, RECORD)), false);
  } finally {
    rmSync(herm.dshHome, { recursive: true, force: true });
    rmSync(herm.project, { recursive: true, force: true });
    rmSync(herm.home, { recursive: true, force: true });
  }
});

