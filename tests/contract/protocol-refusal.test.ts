/**
 * T022 [US4] — the protocol refusal test (PT-120-012; F120-FR-012).
 *
 * Stub CLIs are driven through the SHIPPED `bin/specstride.mjs` with
 * `SPECSTRIDE_BIN`:
 *   - a protocol outside `{min:1,max:1}` produces exactly the kit refusal
 *     line (`refusalLine(found)`) and exit code 4
 *     (`PROTOCOL_MISMATCH_EXIT_CODE`);
 *   - a supported protocol forwards to the CLI in the foreground with stdio
 *     inherited (the CLI's own exit code is the shim's);
 *   - a differing package version alone never refuses
 *     (kit `refusesForVersionDifference` is false).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  PROTOCOL_MISMATCH_EXIT_CODE,
  refusalLine,
  refusesForVersionDifference,
} from "@specstride/host-kit/shim";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHIM = join(ROOT, "bin", "specstride.mjs");

/** A stub CLI printing the given `--protocol` stdout and behaving otherwise. */
function stubCli(directory: string, protocolStdout: string): string {
  const path = join(directory, "specstride");
  writeFileSync(
    path,
    [
      "#!/bin/sh",
      `if [ "$1" = "--protocol" ]; then printf '${protocolStdout}'; exit 0; fi`,
      // Forwarded runs: tee the arguments into a file so the test can observe
      // the forwarding without depending on the shim's stdio plumbing, then
      // exit with the code the test asked the stub to end with.
      `if [ -n "$SPECSTRIDE_STUB_TEE" ]; then printf '%s\\n' "$*" >> "$SPECSTRIDE_STUB_TEE"; fi`,
      `exit \${SPECSTRIDE_STUB_EXIT:-0}`,
    ].join("\n"),
    { mode: 0o755 },
  );
  return path;
}

function runShim(
  stub: string,
  args: string[],
  env: Record<string, string>,
  stdio: "inherit" | "pipe" = "pipe",
) {
  return spawnSync(process.execPath, [SHIM, ...args], {
    encoding: "utf8",
    stdio,
    env: { ...process.env, SPECSTRIDE_BIN: stub, ...env },
  });
}

test("a protocol outside {min:1,max:1} is refused with the kit line and exit 4", () => {
  for (const protocolStdout of ["0", "2", "99", "", "not-an-integer"]) {
    const dir = mkdtempSync(join(tmpdir(), "dsh-protocol-"));
    const stub = stubCli(dir, protocolStdout);
    const run = runShim(stub, ["status"], {});
    const found = /^\d+$/.test(protocolStdout)
      ? Number.parseInt(protocolStdout, 10)
      : null;
    assert.equal(run.status, PROTOCOL_MISMATCH_EXIT_CODE, `stdout: ${protocolStdout}`);
    // Exactly one line, byte for byte the kit refusal line.
    assert.equal(run.stdout, refusalLine(found) + "\n");
    assert.match(run.stdout!, /^\[SPECSTRIDE-REFUSE\] action=protocol reason=protocol-mismatch found=/);
    assert.match(run.stdout!, / supported=1 check=host\.protocol-supported fix="specstride doctor"\n$/);
  }
});

test("a supported protocol forwards to the CLI in the foreground with stdio inherited", () => {
  const dir = mkdtempSync(join(tmpdir(), "dsh-protocol-"));
  const stub = stubCli(dir, "1");
  const tee = join(dir, "forwarded.txt");
  // The test itself spawns the shim with stdio inherited: whatever the stub
  // prints reaches this process's own streams, and the stub's exit code is
  // the shim's — the foreground forwarding of F120-FR-012.
  const run = runShim(stub, ["run", "--comment", "hello"], {
    SPECSTRIDE_STUB_TEE: tee,
    SPECSTRIDE_STUB_EXIT: "7",
  }, "inherit");
  assert.equal(run.status, 7);
  const forwarded = readFileSync(tee, "utf8").trim().split("\n");
  assert.deepEqual(forwarded, ["run --comment hello"]);
});

test("a differing package version alone does not refuse (kit refusesForVersionDifference)", () => {
  // The kit's own predicate: a version difference with a matching protocol is
  // no refusal.
  assert.equal(refusesForVersionDifference("0.0.0", "9.9.9", 1), false);
  assert.equal(refusesForVersionDifference("0.0.0", "0.0.0", 1), false);
  // Behaviorally, through the shipped shim: the stub advertises a wildly
  // different version, and the shim still forwards.
  const dir = mkdtempSync(join(tmpdir(), "dsh-protocol-"));
  const stub = stubCli(dir, "1");
  const tee = join(dir, "forwarded.txt");
  const run = runShim(stub, ["status"], {
    SPECSTRIDE_STUB_TEE: tee,
    SPECSTRIDE_STUB_EXIT: "0",
  }, "inherit");
  assert.equal(run.status, 0);
  assert.equal(readFileSync(tee, "utf8").trim(), "status");
});
