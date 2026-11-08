/**
 * T016 — PT-121-007 (F121-FR-007; HF-23): the workspace resolver. Live sessions
 * (ctx.sessions, header.cwd) and cold ones (ctx.sessionPersistence.list()) resolve;
 * a missing, relative or nonexistent directory — or an id outside
 * ^[A-Za-z0-9_-]{1,128}$ — answers "no-run" with 0 lines in STUB_LOG; the CLI
 * runs with the resolved directory as its cwd. Nothing outside the temporary
 * test workspace is touched.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach } from "node:test";
import { answerSession } from "../../src/server/route.ts";
import { resolveWorkspace } from "../../src/server/workspace.ts";
import { cursorToken, resolveShim } from "../../src/server/cli.ts";
import { ensureStubPeer, readLog } from "./helpers/stub-peer.ts";

const view = JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", "views", "one-feature-each-lane.json"), "utf8"));

let work: string;
let log: string;

beforeEach(() => {
  ensureStubPeer();
  work = mkdtempSync(join(tmpdir(), "kanban-t016-"));
  log = join(work, "stub-log.jsonl");
  process.env.KANBAN_STUB_LOG = log;
  process.env.KANBAN_STUB_SCRIPT = join(work, "stub-script.json");
  // The one happy-path script: the stub answers the fixture view.
  writeFileSync(process.env.KANBAN_STUB_SCRIPT, JSON.stringify({ protocol: 1, mode: "view", view }));
});

after(() => {
  rmSync(work, { recursive: true, force: true });
  delete process.env.KANBAN_STUB_LOG;
  delete process.env.KANBAN_STUB_SCRIPT;
});

function fakeCtx(live: { id: string; cwd?: string }[], cold: { sessionId: string; cwd?: string }[] = []) {
  return {
    sessions: new Map(live.map(({ id, cwd }) => [id, { header: cwd === undefined ? {} : { cwd } }])),
    sessionPersistence: { list: () => cold.map(({ sessionId, cwd }) => ({ sessionId, cwd })) },
  };
}

const get = (ctx: unknown, session: string) => answerSession(ctx as never, session);

test("a live session with an absolute header.cwd resolves, and the CLI runs in that directory", async () => {
  const ctx = fakeCtx([{ id: "live-1", cwd: work }]);
  const answer = await get(ctx, "live-1");
  assert.equal(answer.body.answer, "view");
  assert.equal((answer.body.cursor as { token: string }).token, cursorToken(view as never));
  const calls = readLog(log);
  assert.equal(calls.length, 2, "one --protocol probe and one status call");
  assert.equal(calls[1]!.cwd, work);
  assert.deepEqual(calls[1]!.argv, ["kanban", "status", "--json"]);
});

test("a cold session from sessionPersistence resolves when not live", async () => {
  const coldDir = mkdtempSync(join(tmpdir(), "kanban-t016-cold-"));
  const ctx = fakeCtx([], [{ sessionId: "cold-1", cwd: coldDir }]);
  const answer = await get(ctx, "cold-1");
  assert.equal(answer.body.answer, "view");
  assert.equal(readLog(log)[1]!.cwd, coldDir);
  rmSync(coldDir, { recursive: true, force: true });
});

test("the live header wins over the cold one", () => {
  const ctx = fakeCtx([{ id: "s", cwd: work }], [{ sessionId: "s", cwd: "/definitely/elsewhere" }]);
  assert.deepEqual(resolveWorkspace(ctx as never, "s"), { ok: true, cwd: work });
});

test("an id outside ^[A-Za-z0-9_-]{1,128}$ answers no-run with 0 CLI calls", async () => {
  for (const bad of ["bad/id", "../escape", "", `${"a".repeat(129)}`, "has space", "ümlaut"]) {
    const answer = await get(fakeCtx([{ id: "live-1", cwd: work }]), bad);
    assert.equal(answer.body.answer, "no-run", bad);
    assert.equal(answer.status, 200);
    assert.equal(readLog(log).length, 0, bad);
  }
});

test("a session without cwd answers no-run with 0 CLI calls", async () => {
  const answer = await get(fakeCtx([{ id: "no-cwd" }]), "no-cwd");
  assert.equal(answer.body.answer, "no-run");
  assert.equal(readLog(log).length, 0);
});

test("a relative cwd answers no-run with 0 CLI calls", async () => {
  const answer = await get(fakeCtx([{ id: "rel", cwd: "relative/path" }]), "rel");
  assert.equal(answer.body.answer, "no-run");
  assert.equal(readLog(log).length, 0);
});

test("a nonexistent directory answers no-run with 0 CLI calls", async () => {
  const answer = await get(fakeCtx([{ id: "ghost", cwd: "/definitely/missing-kanban-t016" }]), "ghost");
  assert.equal(answer.body.answer, "no-run");
  assert.equal(readLog(log).length, 0);
});

test("a cold session without cwd answers no-run with 0 CLI calls", async () => {
  const answer = await get(fakeCtx([], [{ sessionId: "cold-no-cwd" }]), "cold-no-cwd");
  assert.equal(answer.body.answer, "no-run");
  assert.equal(readLog(log).length, 0);
});

test("the shim is the resolved peer file, never a PATH binary", () => {
  const shim = resolveShim();
  assert.ok(shim.startsWith("/"), shim);
  assert.ok(shim.endsWith("node_modules/@specstride/host-dsh/bin/specstride.mjs"), shim);
});
