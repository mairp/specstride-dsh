/**
 * T010 — the control-CLI dispatcher.
 * Unknown subcommand refuses with one line; not-yet-wired subcommands name
 * their task and exit non-zero; exit codes propagate.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dispatch } from "../../bin/specstride-host-dsh.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(ROOT, "bin", "specstride-host-dsh.mjs");

function run(
  args: string[],
  env: Record<string, string> = {},
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

test("an unknown subcommand refuses with one line, non-zero", () => {
  const result = run(["frobnicate"]);
  assert.notEqual(result.code, 0);
  const lines = result.stderr.trim().split("\n");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /unknown subcommand "frobnicate"/);
  assert.match(lines[0], /install, uninstall, doctor, eval/);
});

test("eval is wired to the paid lane of T031 and starts nothing on its own", () => {
  // The person-started paid lane: without a mode it prints one line naming
  // the paid lane (F120-FR-024) and exits non-zero — nothing is started.
  const result = run(["eval"]);
  assert.notEqual(result.code, 0, "eval with no mode starts nothing");
  const lines = result.stderr.trim().split("\n");
  assert.equal(lines.length, 1, "eval: exactly one line");
  assert.match(lines[0], /F120-FR-024/);
  assert.match(lines[0], /paid lane/);
  // A run whose configuration names no model refuses before any call.
  const refusal = run(["eval", "suite-run"]);
  assert.notEqual(refusal.code, 0);
  assert.match(refusal.stderr, /RunRefusedError/);
});

test("the eval release-gate mode reads records only and fails on an empty log", () => {
  const home = mkdtempSync(join(tmpdir(), "dsh-cli-gate-"));
  try {
    const result = run(["eval", "release-gate", "--run-log", join(home, "no-log.jsonl")]);
    assert.equal(result.code, 1, "an empty log fails the gate");
    assert.match(result.stdout, /F120-FR-024/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("install and uninstall are wired to src/installer.ts (T026–T027)", () => {
  const home = mkdtempSync(join(tmpdir(), "dsh-cli-wired-"));
  try {
    const env = { DSH_HOME: home, PROJECT_ROOT: home, HOME: home };
    const installed = run(["install"], env);
    assert.equal(installed.code, 0, installed.stderr);
    assert.ok(existsSync(join(home, "skills", ".specstride-host-dsh-install.json")));
    const removed = run(["uninstall"], env);
    assert.equal(removed.code, 0, removed.stderr);
    assert.equal(existsSync(join(home, "skills")), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("dispatch returns the exit codes the same way", async () => {
  assert.equal(await dispatch(["node", "cli", "frobnicate"]), 2);
  assert.equal(await dispatch(["node", "cli"]), 2);
});

test("the doctor subcommand is wired to the runner of T020 (exit per DOCTOR_EXITS)", async () => {
  const result = run(["doctor"]);
  const { DOCTOR_EXIT_CODES } = await import("@specstride/host-kit");
  assert.ok(
    (DOCTOR_EXIT_CODES as readonly number[]).includes(result.code),
    `exit ${result.code} is one of the kit's doctor exits`,
  );
  assert.match(result.stdout, /host\.cli-found/);
});

test("the dispatcher runs standalone with a non-zero exit on an unknown subcommand", () => {
  const result = run(["--help"]);
  assert.match(result.stdout, /usage: specstride-host-dsh/);
});
