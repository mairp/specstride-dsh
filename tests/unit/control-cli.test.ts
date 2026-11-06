/**
 * T010 — the control-CLI dispatcher.
 * Unknown subcommand refuses with one line; not-yet-wired subcommands name
 * their task and exit non-zero; exit codes propagate.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { dispatch } from "../../bin/specstride-host-dsh.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(ROOT, "bin", "specstride-host-dsh.mjs");

function run(args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      cwd: ROOT,
      encoding: "utf8",
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

test("a subcommand that is not yet wired names its task and exits non-zero", () => {
  for (const [subcommand, task] of [
    ["install", "T026"],
    ["uninstall", "T027"],
    ["eval", "T031"],
  ] as const) {
    const result = run([subcommand]);
    assert.notEqual(result.code, 0, `${subcommand} is not wired yet`);
    const lines = result.stderr.trim().split("\n");
    assert.equal(lines.length, 1, `${subcommand}: exactly one line`);
    assert.match(lines[0], new RegExp(task));
    assert.match(lines[0], /specs\/120-host-dsh/);
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
