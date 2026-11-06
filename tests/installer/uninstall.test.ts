/**
 * T025 — the uninstaller test (PT-120-021; F120-FR-021).
 *
 * Exactly the recorded files whose hash still matches are removed; a file
 * the consumer changed is kept and reported; the record is removed last; an
 * uninstall with no record refuses with one line. Every case runs against a
 * temporary `DSH_HOME` only (F120-FR-020).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(ROOT, "bin", "specstride-host-dsh.mjs");
const RECORD = ".specstride-host-dsh-install.json";
const SPELLINGS = ["specstride-run", "specstride-reverse", "specstride-doctor"];

function sha256Of(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function tempRoot(label: string): string {
  return mkdtempSync(join(tmpdir(), `dsh-uninstall-${label}-`));
}

function run(args: readonly string[], env: Record<string, string>): { code: number; stdout: string; stderr: string } {
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

function hermetic(): { env: Record<string, string>; dshHome: string; root: string } {
  const dshHome = tempRoot("home");
  const env = {
    DSH_HOME: dshHome,
    PROJECT_ROOT: tempRoot("project"),
    HOME: tempRoot("shared"),
  };
  return { env, dshHome, root: join(dshHome, "skills") };
}

test("uninstall removes exactly the recorded files whose hash still matches, and the record last", () => {
  const herm = hermetic();
  try {
    assert.equal(run(["install"], herm.env).code, 0);
    const recordPath = join(herm.root, RECORD);
    const result = run(["uninstall"], herm.env);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(existsSync(herm.root), false, "the whole installed tree is gone");
    assert.equal(existsSync(recordPath), false, "the record is removed");
    assert.ok(existsSync(herm.dshHome), "nothing outside the root is touched");
  } finally {
    rmSync(herm.dshHome, { recursive: true, force: true });
    rmSync(herm.env.PROJECT_ROOT, { recursive: true, force: true });
    rmSync(herm.env.HOME, { recursive: true, force: true });
  }
});

test("a file the consumer changed is kept and reported", () => {
  const herm = hermetic();
  try {
    assert.equal(run(["install"], herm.env).code, 0);
    const consumerEdited = join(herm.root, "specstride-reverse", "SKILL.md");
    writeFileSync(consumerEdited, "---\nname: specstride-reverse\n---\nmy local edits\n");
    const result = run(["uninstall"], herm.env);
    assert.equal(result.code, 0, result.stderr);
    const report = result.stdout + result.stderr;
    assert.match(report, /specstride-reverse\/SKILL\.md/, "the kept file is reported");
    assert.equal(existsSync(consumerEdited), true, "the changed file is kept");
    assert.equal(existsSync(join(herm.root, RECORD)), false, "the record is removed last");
    // Everything else was removed.
    assert.equal(existsSync(join(herm.root, "specstride-run")), false);
    assert.equal(existsSync(join(herm.root, "specstride-doctor")), false);
    assert.deepEqual(readdirSync(join(herm.root, "specstride-reverse")), ["SKILL.md"]);
  } finally {
    rmSync(herm.dshHome, { recursive: true, force: true });
    rmSync(herm.env.PROJECT_ROOT, { recursive: true, force: true });
    rmSync(herm.env.HOME, { recursive: true, force: true });
  }
});

test("an uninstall with no record refuses with one line", () => {
  const herm = hermetic();
  try {
    mkdirSync(herm.root, { recursive: true });
    const result = run(["uninstall"], herm.env);
    assert.notEqual(result.code, 0);
    const lines = result.stderr.trim().split("\n");
    assert.equal(lines.length, 1, `one line, got: ${result.stderr}`);
    assert.match(lines[0], /no (install )?record/i);
    // An entirely absent root refuses the same way.
    const absent = hermetic();
    try {
      const other = run(["uninstall"], absent.env);
      assert.notEqual(other.code, 0);
      assert.equal(other.stderr.trim().split("\n").length, 1);
    } finally {
      rmSync(absent.dshHome, { recursive: true, force: true });
      rmSync(absent.env.PROJECT_ROOT, { recursive: true, force: true });
      rmSync(absent.env.HOME, { recursive: true, force: true });
    }
  } finally {
    rmSync(herm.dshHome, { recursive: true, force: true });
    rmSync(herm.env.PROJECT_ROOT, { recursive: true, force: true });
    rmSync(herm.env.HOME, { recursive: true, force: true });
  }
});
