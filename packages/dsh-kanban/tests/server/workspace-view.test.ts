/**
 * The workspace reader: a specstride.view/1 from tasks.md, gate files and the
 * bash engine's events.jsonl, for when no engine answers `kanban status --json`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWorkspaceView, STALE_AFTER_MS, type FsPort } from "../../src/server/workspace-view.ts";
import { fromWorkspace } from "../../src/server/route.ts";
import { acceptView } from "../../src/shared/view-read.ts";
import { cardNode } from "../../src/shared/board-model.ts";

const NOW = Date.parse("2026-11-08T12:00:00.000Z");

function memFs(files: Record<string, string>): FsPort {
  const norm = (p: string) => p.replace(/\/+$/, "");
  return {
    list: (path) => {
      const prefix = `${norm(path)}/`;
      const names = new Set<string>();
      for (const key of Object.keys(files)) if (key.startsWith(prefix)) names.add(key.slice(prefix.length).split("/")[0] as string);
      return [...names];
    },
    read: (path) => files[norm(path)] ?? null,
    exists: (path) => Object.keys(files).some((k) => k === norm(path) || k.startsWith(`${norm(path)}/`)),
    size: (path) => (files[norm(path)] ?? "").length,
  };
}

const TASKS = [
  "# Tasks",
  "## Phase 1: Setup",
  "- [x] T001 a",
  "- [x] T002 b",
  "## Phase 2: Core",
  "- [x] T003 c",
  "- [ ] T004 d",
  "## Phase 3: Polish",
  "- [ ] T005 e",
  "## Notes",
  "- [ ] not a phase task",
].join("\n");

const ev = (o: Record<string, unknown>) => JSON.stringify(o);
const lanesOf = (view: ReturnType<typeof readWorkspaceView>, feature: string) =>
  view.cards.filter((c) => c.feature === feature).map((c) => `${c.phase}:${c.lane}`).join(" ");

test("every ticked task approves the phase; the rest queue", () => {
  const view = readWorkspaceView("/w", memFs({ "/w/specs/f1/tasks.md": TASKS }), NOW);
  assert.equal(lanesOf(view, "f1"), "1:approved 2:queued 3:queued");
  assert.equal(view.state, "idle");
  assert.ok(acceptView(view).ok, "the view passes the client's acceptance");
});

test("a GATE<N>-APPROVED file approves the phase", () => {
  const view = readWorkspaceView("/w", memFs({ "/w/specs/f1/tasks.md": TASKS, "/w/.specstride/features/f1/gates/GATE2-APPROVED": "" }), NOW);
  assert.equal(lanesOf(view, "f1"), "1:approved 2:approved 3:queued");
});

test("a live run in the critic puts the current phase in reviewing, and the workspace is running", () => {
  const events = [
    ev({ event: "run_start", feature: "f1", run_id: "r1", time: "2026-11-08T11:30:00Z" }),
    ev({ event: "phase_start", feature: "f1", run_id: "r1", phase: "2", time: "2026-11-08T11:31:00Z" }),
    ev({ event: "verification_start", feature: "f1", run_id: "r1", time: "2026-11-08T11:40:00Z" }),
    ev({ event: "critic_start", run_id: "r1", time: "2026-11-08T11:50:00Z" }),
  ].join("\n");
  const view = readWorkspaceView("/w", memFs({ "/w/specs/f1/tasks.md": TASKS, "/w/.specstride/events.jsonl": events }), NOW);
  assert.equal(lanesOf(view, "f1"), "1:approved 2:reviewing 3:queued");
  assert.equal(view.state, "running");
});

test("a live run whose newest event is older than the stale bound is flagged stale", () => {
  const old = new Date(NOW - STALE_AFTER_MS - 60_000).toISOString();
  const events = [ev({ event: "phase_start", feature: "f1", run_id: "r1", phase: "2", time: old })].join("\n");
  const view = readWorkspaceView("/w", memFs({ "/w/specs/f1/tasks.md": TASKS, "/w/.specstride/events.jsonl": events }), NOW);
  const card = view.cards.find((c) => c.id === "f1#2");
  assert.equal(card?.lane, "proposing");
  assert.equal(card?.flags.stale, true);
  assert.equal(view.state, "idle");
});

test("run_end outcomes: crashed → failed, yield → paused, all_approved → every phase approved", () => {
  const end = (outcome: string) =>
    [
      ev({ event: "phase_start", feature: "f1", run_id: "r1", phase: 2, time: "2026-11-08T11:00:00Z" }),
      ev({ event: "run_end", feature: "f1", run_id: "r1", outcome, time: "2026-11-08T11:10:00Z" }),
    ].join("\n");
  const read = (outcome: string) => readWorkspaceView("/w", memFs({ "/w/specs/f1/tasks.md": TASKS, "/w/.specstride/events.jsonl": end(outcome) }), NOW);
  assert.equal(lanesOf(read("crashed"), "f1"), "1:approved 2:failed 3:queued");
  assert.equal(lanesOf(read("yield"), "f1"), "1:approved 2:paused 3:queued");
  assert.equal(lanesOf(read("all_approved"), "f1"), "1:approved 2:approved 3:approved");
});

test("a feature nothing has started is one queued card; no phased spec at all is `none`", () => {
  const untouched = "## Phase 1: A\n- [ ] T1\n## Phase 2: B\n- [ ] T2\n";
  const view = readWorkspaceView("/w", memFs({ "/w/specs/f2/tasks.md": untouched }), NOW);
  assert.deepEqual(view.cards.map((c) => [c.id, c.lane, c.phase]), [["f2#queued", "queued", null]]);
  assert.equal(readWorkspaceView("/w", memFs({ "/w/README.md": "x" }), NOW).state, "none");
});

test("the signature is stable across reads and changes when a task is ticked", () => {
  const files = { "/w/specs/f1/tasks.md": TASKS };
  const a = readWorkspaceView("/w", memFs(files), NOW).signature.token;
  const b = readWorkspaceView("/w", memFs(files), NOW).signature.token;
  const c = readWorkspaceView("/w", memFs({ "/w/specs/f1/tasks.md": TASKS.replace("- [ ] T004", "- [x] T004") }), NOW).signature.token;
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("the card text carries the phase title as text; untitled cards stay as before", () => {
  const view = readWorkspaceView("/w", memFs({ "/w/specs/f1/tasks.md": TASKS }), NOW);
  const text = (cardNode(view.cards[0]!) as { children: { text?: string }[] }).children[0]!.text;
  assert.equal(text, "phase 1 — Setup");
  const plain = cardNode({ id: "x", feature: "f", phase: 2, lane: "queued", ruleId: "r", flags: {} });
  assert.equal((plain as { children: { text?: string }[] }).children[0]!.text, "f · phase 2");
});

test("the route fallback answers view, then unchanged for the same cursor, and unavailable for a workspace with no phased spec", () => {
  const dir = mkdtempSync(join(tmpdir(), "kanban-ws-"));
  mkdirSync(join(dir, "specs", "f1"), { recursive: true });
  writeFileSync(join(dir, "specs", "f1", "tasks.md"), TASKS);
  const first = fromWorkspace(dir, null);
  assert.equal(first.kind, "view");
  const token = (first as { cursorToken: string }).cursorToken;
  assert.match(token, /^[0-9]+\.[0-9]+\.[0-9a-f]{8}$/, "the token matches the route's cursor pattern");
  assert.equal(fromWorkspace(dir, token).kind, "unchanged");
  assert.equal(fromWorkspace(mkdtempSync(join(tmpdir(), "kanban-empty-")), null).kind, "unavailable");
});
