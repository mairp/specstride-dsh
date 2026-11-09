/**
 * F121-FR-022 (PT-121-022): the detail panel and the card that opens it — pure,
 * text-only, three channels per state, a card without a detail unchanged; the
 * client opens and closes it by click, Enter/Space and Escape, and a good
 * answer clears the staleness line.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { boardTree } from "../../src/shared/board-tree.ts";
import { cardNode } from "../../src/shared/board-model.ts";
import { detailTree, compact, shortTime, usageText } from "../../src/shared/detail-tree.ts";
import { DETAIL_SETS, outcomePresentation } from "../../src/shared/presentation.ts";
import { serialize, type Node } from "../../src/shared/tree.ts";
import type { FeatureDetail, PhaseDetail, ReadView, ViewCard } from "../../src/shared/view-read.ts";
import { detailEvent } from "../../src/client/index.ts";
import { startPoller } from "../../src/client/poller.ts";

const phase: PhaseDetail = {
  goal: "the core works",
  independentTest: "run the core",
  checkpoint: "T003 passes",
  tasksDone: 1,
  tasksTotal: 2,
  tasks: [
    { id: "T003", text: "Add <b>tests</b>", done: true, parallel: true, story: "US1", verdict: "MET" },
    { id: "T004", text: "Create core", done: false, parallel: false, story: null, verdict: "UNMET" },
  ],
  tasksOmitted: 3,
  files: ["src/core.ts"],
  filesOmitted: 0,
  approval: null,
  evidence: { name: ".specstride/features/f1/evidence/GATE2-EVIDENCE.md", bytes: 17639 },
  attempts: [{ attempt: 1, run: "run-5a942a3c", launch: "launch-two", strategy: "micro", startedAt: "2026-11-09T01:16:15.573Z", endedAt: null, outcome: "open", passes: 2, errors: 0 }],
  attemptsOmitted: 0,
  counters: { rejects: 1, errors: 0, noProgress: 0, caps: 0 },
  units: null,
  usage: { sessions: 2, calls: 40, tokensIn: 167694, tokensOut: 62692, retries: 0, rateLimited: 0, backoffMs: 0, models: ["zai/glm-5.3-flash"] },
  current: true,
};
const feature: FeatureDetail = {
  run: { id: "run-5a942a3c", launch: "launch-two", state: "running", phase: 2, startedAt: null, lastAt: "2026-11-09T01:49:06.011Z" },
  agents: [{ role: "proposer", what: "pass 1/30 · step 53", since: "2026-11-09T01:49:05.570Z", pid: 4022094, alive: true, harness: "dsh", profile: "headless", model: "zai/glm-5.3-flash" }],
  agentsNote: null,
  launches: [
    { launch: "launch-one", reason: "first", state: "signalled", at: null, endedAt: null, exit: "SIGTERM", run: "run-first", current: false },
    { launch: "launch-two", reason: "first", state: "running", at: null, endedAt: null, exit: null, run: "run-5a942a3c", current: true },
  ],
  launchesOmitted: 0,
  log: ["----- proposer pass 1/30 -----"],
  usage: null,
  cost: "not reported by dsh (tokens only)",
  limits: "no rate limit hit",
  usageNote: null,
};
const card = (detail?: PhaseDetail): ViewCard => ({ id: "f1#2", feature: "f1", phase: 2, lane: "proposing", ruleId: "W-proposing", flags: {}, title: "Core", ...(detail === undefined ? {} : { detail }) });

function view(cards: ViewCard[]): ReadView {
  return {
    schema: "specstride.view/1", runId: "workspace:x", workspaceId: "x", feature: null, state: "running", display: "running",
    conditions: { dead: false, stale: null, launchAbandoned: false }, cards,
    lanes: [{ lane: "proposing", cards: cards.map((c) => c.id) }], laneTable: { id: "t", version: "1" },
    attention: [], attentionOmitted: 0, budget: [], budgetOmitted: 0, phases: [], cursor: { offset: 0, lastSeq: 0 }, signature: { token: "s" },
    featureDetails: { f1: feature },
  };
}

const find = (node: Node, test: (n: Node) => boolean): Node[] => [...(test(node) ? [node] : []), ...node.children.flatMap((c) => find(c, test))];
const texts = (node: Node): string => [node.text ?? "", ...node.children.map(texts)].join(" ");

test("a card without a detail keeps exactly its four attributes; one with a detail is a focusable button", () => {
  assert.deepEqual(Object.keys(cardNode(card()).attrs).sort(), ["data-card-id", "data-feature", "data-lane", "data-rule-id"]);
  const opens = cardNode(card(phase)).attrs;
  assert.equal(opens.role, "button");
  assert.equal(opens.tabindex, "0");
  assert.equal(opens["aria-pressed"], "false");
});

test("no selection, no panel; the selected card is pressed and the panel follows the columns — equal input, equal tree", () => {
  const v = view([card(phase)]);
  assert.equal(find(boardTree(v), (n) => n.attrs["data-kanban-detail"] !== undefined).length, 0);
  const tree = boardTree(v, { selectedId: "f1#2" });
  const pressed = find(tree, (n) => n.attrs["data-card-id"] === "f1#2")[0]!;
  assert.equal(pressed.attrs["aria-pressed"], "true");
  const panel = find(tree, (n) => n.attrs["data-kanban-detail"] === "f1#2");
  assert.equal(panel.length, 1);
  assert.equal(serialize(tree), serialize(boardTree(view([card(phase)]), { selectedId: "f1#2" })));
  // An id the view no longer holds opens nothing (the selection survives a poll, the panel does not invent a card).
  assert.equal(find(boardTree(v, { selectedId: "gone#1" }), (n) => n.attrs["data-kanban-detail"] !== undefined).length, 0);
});

test("the panel shows scope, live agent, attempts, launches and cost — as text, every state with glyph, label and grayscale", () => {
  const panel = detailTree(card(phase), feature, "ssk-00000000");
  const sections = find(panel, (n) => n.attrs["data-detail-section"] !== undefined).map((n) => n.attrs["data-detail-section"]);
  assert.deepEqual(sections, ["scope", "live", "attempts", "launches", "cost"]);
  const all = texts(panel);
  for (const fact of ["the core works", "Tasks 1/2 done", "Add <b>tests</b>", "and 3 more tasks", "src/core.ts", "pid 4022094", "zai/glm-5.3-flash", "attempt 1", "launch-two", "SIGTERM", "167.7k in / 62.7k out tokens", "not reported by dsh"]) {
    assert.ok(all.includes(fact), `panel shows ${fact}`);
  }
  for (const b of find(panel, (n) => n.attrs.class === "ssk-00000000-badge")) {
    assert.ok(b.text !== undefined && b.attrs["aria-label"] !== undefined && b.attrs["data-gray"] !== undefined, "three channels");
  }
  const close = find(panel, (n) => n.attrs["data-kanban-detail-close"] !== undefined)[0]!;
  assert.equal(close.tag, "button");
  assert.equal(texts(detailTree(card(), null, "p")).includes("No detail available for this card"), true);
});

test("the detail sets: glyph, label and grayscale pairwise distinct (grays ≥ 24 apart, the unknown member included); an unknown member reads `?` and its value", () => {
  for (const [name, set] of Object.entries(DETAIL_SETS)) {
    const members = [...Object.values(set.members), set.unknown];
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        const a = members[i]!;
        const b = members[j]!;
        assert.notEqual(a.label, b.label, `${name}: labels`);
        assert.ok(Math.abs(a.grayscale - b.grayscale) >= 24, `${name}: ${a.label} vs ${b.label} grays`);
        if (j < members.length - 1) assert.notEqual(a.glyph, b.glyph, `${name}: glyphs`);
      }
    }
  }
  assert.deepEqual([outcomePresentation("newer").glyph, outcomePresentation("newer").label], ["?", "newer"]);
});

test("formatting helpers are pure", () => {
  assert.equal(shortTime("2026-11-09T01:49:05.570Z"), "11-09 01:49:05Z");
  assert.equal(shortTime(null), "—");
  assert.deepEqual([compact(999), compact(1500), compact(1_534_000)], ["999", "1.5k", "1.53M"]);
  assert.equal(usageText(null), "none recorded");
});

/* --------------------------------- the client --------------------------------- */

type El = { attrs: Record<string, string>; parent: El | null; focused?: boolean };
const elOf = (attrs: Record<string, string>, parent: El | null = null): El => ({ attrs, parent });
const asTarget = (el: El) => ({
  closest(selector: string): unknown {
    const name = /^\[([\w-]+)\]$/.exec(selector)?.[1] ?? "";
    for (let at: El | null = el; at !== null; at = at.parent) if (name in at.attrs) return asTarget(at);
    return null;
  },
  getAttribute: (name: string) => el.attrs[name] ?? null,
  focus: () => {
    el.focused = true;
  },
});

test("click, Enter/Space open a card's detail; a second click, Close and Escape close it", () => {
  let open: string | null = null;
  const pane = { select: (id: string | null) => { open = id; }, selected: () => open };
  const cardEl = elOf({ "data-card-id": "f1#2", "data-has-detail": "true" });
  const label = elOf({}, cardEl);
  detailEvent({ type: "click", target: asTarget(label) }, pane);
  assert.equal(open, "f1#2");
  detailEvent({ type: "click", target: asTarget(label) }, pane);
  assert.equal(open, null, "a second click on the open card closes it");
  let prevented = 0;
  detailEvent({ type: "keydown", key: "Enter", target: asTarget(cardEl), preventDefault: () => (prevented += 1) }, pane);
  assert.equal(open, "f1#2");
  detailEvent({ type: "keydown", key: "Escape", target: asTarget(cardEl), preventDefault: () => (prevented += 1) }, pane);
  assert.equal(open, null);
  detailEvent({ type: "keydown", key: " ", target: asTarget(cardEl), preventDefault: () => (prevented += 1) }, pane);
  assert.equal(open, "f1#2");
  detailEvent({ type: "click", target: asTarget(elOf({ "data-kanban-detail-close": "" })) }, pane);
  assert.equal(open, null);
  assert.equal(prevented, 3);
  // A card without a detail opens nothing.
  detailEvent({ type: "click", target: asTarget(elOf({ "data-card-id": "f1#1" })) }, pane);
  assert.equal(open, null);
});

test("a good answer after a failure clears the staleness line (it no longer sticks forever)", async () => {
  const events: string[] = [];
  const timers: Array<() => void> = [];
  const answers: unknown[] = [{ answer: "unavailable" }, { answer: "unchanged", cursor: { token: "1.1.aaaaaaaa" } }];
  const poller = startPoller({
    sessionId: "s1",
    timers: { setTimeout: (fn: () => void) => { timers.push(fn); return timers.length; }, clearTimeout: () => {} },
    fetch: async () => ({ json: async () => answers.shift() as never }),
    render: () => events.push("render"),
    stale: () => events.push("stale"),
    fresh: () => events.push("fresh"),
  });
  const settle = () => new Promise((r) => setImmediate(r));
  await settle();
  assert.deepEqual(events, ["stale"]);
  timers.pop()!(); // the backoff (the newest timer; the first is the request limit) fires the next poll
  await settle();
  assert.deepEqual(events, ["stale", "fresh"]);
  poller.dispose();
});
