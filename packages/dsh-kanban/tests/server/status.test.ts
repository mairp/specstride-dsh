/**
 * T017 — PT-121-004 second half (F121-FR-004): the CLI protocol, through the
 * stub peer. A view answers "view" with the cursor token
 * `<offset>.<lastSeq>.<signature.token>`; no-state/no-feature answer "no-run";
 * schema major 2 answers "refused-schema"; exit 70, unparsable output and output
 * above 512 KiB answer "unavailable". The spawned program is the resolved
 * `@specstride/host-dsh/bin/specstride.mjs`, never a `specstride` from PATH, and
 * 120's protocol check runs first: a shim whose --protocol answers 2 (exit 4)
 * produces "unavailable" with no status call recorded.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "node:test";
import { answerSession } from "../../src/server/route.ts";
import { resolveShim, status } from "../../src/server/cli.ts";
import { ensureStubPeer, readLog, stubShimPath } from "./helpers/stub-peer.ts";

const views = join(import.meta.dirname, "..", "fixtures", "views");
const view = JSON.parse(readFileSync(join(views, "one-feature-each-lane.json"), "utf8"));
const schemaMajor2 = JSON.parse(readFileSync(join(views, "schema-major-2.json"), "utf8"));

let work: string;
let log: string;

function stub(mode: string, extra: Record<string, unknown> = {}): void {
  writeFileSync(join(work, "stub-script.json"), JSON.stringify({ protocol: 1, mode, ...extra }));
}

beforeEach(() => {
  ensureStubPeer();
  work = mkdtempSync(join(tmpdir(), "kanban-t017-"));
  log = join(work, "stub-log.jsonl");
  process.env.KANBAN_STUB_LOG = log;
  process.env.KANBAN_STUB_SCRIPT = join(work, "stub-script.json");
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
  delete process.env.KANBAN_STUB_LOG;
  delete process.env.KANBAN_STUB_SCRIPT;
});

test("a view answers view with the cursor token <offset>.<lastSeq>.<signature.token>", async () => {
  stub("view", { view });
  const result = await status(work);
  assert.deepEqual(result, { kind: "view", view, cursorToken: "1024.12.0a1b2c3d" });
  const calls = readLog(log);
  assert.deepEqual(calls.map((call) => call.argv), [["--protocol"], ["kanban", "status", "--json"]]);
  assert.equal(calls[1]!.cwd, work);
});

test("the spawned program is the resolved peer shim, not a PATH binary", () => {
  assert.equal(resolveShim(), stubShimPath);
  assert.ok(stubShimPath.startsWith("/"));
});

for (const [mode, expected] of [
  ["no-state", "no-run"],
  ["no-feature", "no-run"],
] as const) {
  test(`the ${mode} envelope answers no-run`, async () => {
    stub(mode);
    assert.deepEqual(await status(work), { kind: expected });
    assert.equal(readLog(log).length, 2);
  });
}

test("schema major 2 answers refused-schema", async () => {
  stub("view", { view: schemaMajor2 });
  assert.deepEqual(await status(work), { kind: "refused-schema" });
});

for (const mode of ["exit70", "junk", "big"] as const) {
  test(`${mode === "exit70" ? "exit 70" : mode === "junk" ? "unparsable output" : "output above 512 KiB"} answers unavailable`, async () => {
    stub(mode);
    assert.deepEqual(await status(work), { kind: "unavailable" });
  });
}

test("a --protocol answer of 2 (exit 4) makes the route answer unavailable with no status call", async () => {
  writeFileSync(join(work, "stub-script.json"), JSON.stringify({ protocol: 2, protocolExit: 4 }));
  const ctx = { sessions: new Map([["s1", { header: { cwd: work } }]]), sessionPersistence: { list: () => [] } };
  const answer = await answerSession(ctx as never, "s1");
  assert.equal(answer.body.answer, "unavailable");
  const calls = readLog(log);
  assert.equal(calls.length, 1, "only the protocol probe ran");
  assert.deepEqual(calls[0]!.argv, ["--protocol"]);
});
