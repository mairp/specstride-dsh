/**
 * T027 — PT-121-010, PT-121-004 (F121-FR-004, F121-FR-010): the wait path,
 * through the stub peer. One call per cycle is
 * `kanban wait --until-change --cursor <token> --timeout 25`, still behind the
 * `--protocol` probe and the resolved peer shim, never a PATH binary. Exit 0
 * with no output answers "unchanged" and carries the same cursor — no
 * `status --json` runs. Exit 0 with a change line runs `status --json` exactly
 * once and answers "view" with the new cursor. A `wait` that never returns is
 * killed by the runner's hard limit (30 s) and answers "unavailable".
 *
 * The shared helper's shim only speaks `status`, so this file installs its own
 * wait-aware shim into the same peer location (same log contract), reusing
 * `ensureStubPeer`'s files and `readLog`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "node:test";
import { wait } from "../../src/server/cli.ts";
import { ensureStubPeer, readLog, stubShimPath } from "./helpers/stub-peer.ts";

const views = join(import.meta.dirname, "..", "fixtures", "views");
const view = JSON.parse(readFileSync(join(views, "one-feature-each-lane.json"), "utf8"));
const CURSOR = "1024.12.0a1b2c3d";

const WAIT_SHIM = `#!/usr/bin/env node
// T027 — the wait-aware stub peer shim. Same logging contract as the helper's
// shim: every invocation appends one line { argv, cwd } to KANBAN_STUB_LOG.
// wait is driven by script.waitMode; status --json by script.statusMode.
import fs from "node:fs";

const argv = process.argv.slice(2);
const logPath = process.env.KANBAN_STUB_LOG;
const scriptPath = process.env.KANBAN_STUB_SCRIPT;
const script = scriptPath ? JSON.parse(fs.readFileSync(scriptPath, "utf8")) : {};
if (logPath) fs.appendFileSync(logPath, JSON.stringify({ argv, cwd: process.cwd() }) + "\\n");

const out = (text) => fs.writeSync(1, text + "\\n");

if (argv.length === 1 && argv[0] === "--protocol") {
  out(String(script.protocol ?? 1));
  process.exit(0);
}

if (argv[0] === "kanban" && argv[1] === "status" && argv[2] === "--json") {
  if (script.statusMode === "view") { out(JSON.stringify(script.view)); process.exit(0); }
  process.exit(1);
}

if (argv[0] === "kanban" && argv[1] === "wait") {
  if (script.waitMode === "unchanged") process.exit(0);
  if (script.waitMode === "changed") { out(script.line); process.exit(0); }
  if (script.waitMode === "hang") {
    // Never exits on its own: the open interval keeps the loop alive until the
    // runner's 30 s hard limit kills the process group.
    setInterval(() => {}, 1000);
  } else {
    fs.writeSync(2, "stub shim: refused argv " + JSON.stringify(argv) + "\\n");
    process.exit(3);
  }
}
`;

let work: string;
let log: string;

function stub(script: Record<string, unknown>): void {
  writeFileSync(join(work, "stub-script.json"), JSON.stringify({ protocol: 1, ...script }));
}

beforeEach(() => {
  ensureStubPeer();
  // The helper's shim refuses `kanban wait`; install the wait-aware one.
  writeFileSync(stubShimPath, WAIT_SHIM, "utf8");
  work = mkdtempSync(join(tmpdir(), "kanban-t027-"));
  log = join(work, "stub-log.jsonl");
  process.env.KANBAN_STUB_LOG = log;
  process.env.KANBAN_STUB_SCRIPT = join(work, "stub-script.json");
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
  delete process.env.KANBAN_STUB_LOG;
  delete process.env.KANBAN_STUB_SCRIPT;
});

function waitCalls(): { argv: string[]; cwd: string }[] {
  return readLog(log).filter((call) => call.argv[1] === "wait");
}

function statusCalls(): { argv: string[]; cwd: string }[] {
  return readLog(log).filter((call) => call.argv[1] === "status");
}

test("with a cursor, the stub records `wait --until-change --cursor <token> --timeout 25` in the workspace", async () => {
  stub({ waitMode: "unchanged" });
  await wait(work, CURSOR);
  const calls = waitCalls();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!.argv, ["kanban", "wait", "--until-change", "--cursor", CURSOR, "--timeout", "25"]);
  assert.equal(calls[0]!.cwd, work);
});

test("exit 0 without output answers unchanged with the same cursor and runs no status", async () => {
  stub({ waitMode: "unchanged" });
  assert.deepEqual(await wait(work, CURSOR), { kind: "unchanged", cursorToken: CURSOR });
  assert.equal(statusCalls().length, 0, "no status --json on an unchanged cycle");
});

test("exit 0 with a change line runs status --json once and answers view with the new cursor", async () => {
  stub({
    waitMode: "changed",
    line: "run=r st=done cur=" + CURSOR,
    statusMode: "view",
    view,
  });
  assert.deepEqual(await wait(work, CURSOR), { kind: "view", view, cursorToken: CURSOR });
  assert.deepEqual(statusCalls().map((call) => call.argv), [["kanban", "status", "--json"]]);
});

test("a hanging wait is killed by the runner's hard limit (30 s) and answers unavailable", { timeout: 90_000 }, async () => {
  stub({ waitMode: "hang" });
  const start = Date.now();
  assert.deepEqual(await wait(work, CURSOR), { kind: "unavailable" });
  // Survived well past the 25 s wait timeout — the kill is the runner's 30 s
  // hard limit, not an idle timeout.
  assert.ok(Date.now() - start >= 24_000, "the hanging wait was killed too early");
  assert.equal(waitCalls().length, 1);
  assert.equal(statusCalls().length, 0, "no status --json after a killed wait");
});
