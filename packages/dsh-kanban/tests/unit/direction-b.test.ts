/**
 * Direction B of the design pass (prompts/kanban-ui-direction-b.md): the run
 * strip, the lane rails and counts, the split card line and the inspector.
 * Every piece only re-reads what the view placed — counts and tints — and
 * renders text as text; nothing here assigns a lane.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { boardTree, DEFAULT_PREFIX, SUMMARY_FEATURES } from "../../src/shared/board-tree.ts";
import { cardNode } from "../../src/shared/board-model.ts";
import type { Node } from "../../src/shared/tree.ts";
import type { FeatureDetail, PhaseDetail, ReadView, ViewCard } from "../../src/shared/view-read.ts";

const P = DEFAULT_PREFIX;

function flatten(node: Node): Node[] {
  return [node, ...node.children.flatMap(flatten)];
}
const byClass = (nodes: Node[], suffix: string) => nodes.filter((n) => n.attrs["class"] === `${P}-${suffix}`);
const textOf = (node: Node): string => [node.text ?? "", ...node.children.map(textOf)].filter((t) => t !== "").join(" ");

const detail: PhaseDetail = {
  goal: "g", independentTest: null, checkpoint: null, tasksDone: 0, tasksTotal: 0, tasks: [], tasksOmitted: 0,
  files: [], filesOmitted: 0, approval: null, evidence: null, attempts: [], attemptsOmitted: 0, counters: null,
  units: null, usage: null, current: false,
};
const run: FeatureDetail["run"] = { id: "run-f10a1dfe", launch: null, state: "crash", phase: 10, startedAt: null, lastAt: "2026-11-09T09:27:02.000Z" };
const featureDetail = (r: FeatureDetail["run"]): FeatureDetail => ({
  run: r, agents: [], agentsNote: null, launches: [], launchesOmitted: 0, log: [], usage: null,
  cost: "not reported by dsh (tokens only)", limits: "none", usageNote: null,
});

const card = (feature: string, phase: number, lane: string, title = `Phase ${phase} title`, withDetail = false): ViewCard => ({
  id: `${feature}#${phase}`, feature, phase, lane, ruleId: `W-${lane}`, flags: {}, title, ...(withDetail ? { detail } : {}),
});

function view(cards: ViewCard[], featureDetails: Record<string, FeatureDetail> = {}): ReadView {
  const lanes = [...new Set(cards.map((c) => c.lane))].map((lane) => ({ lane, cards: cards.filter((c) => c.lane === lane).map((c) => c.id) }));
  return {
    schema: "specstride.view/1", runId: "workspace:x", workspaceId: "x", feature: null, state: "running", display: "running",
    conditions: { dead: false, stale: null, launchAbandoned: false }, cards, lanes, laneTable: { id: "t", version: "1" },
    attention: [], attentionOmitted: 0, budget: [], budgetOmitted: 0, phases: [], cursor: { offset: 0, lastSeq: 0 }, signature: { token: "s" },
    featureDetails,
  } as ReadView;
}

// Phases listed out of order on purpose: the strip sorts a feature's segments by phase.
const live = view([
  card("f1", 3, "reviewing"), card("f1", 1, "approved"), card("f1", 2, "approved", "Foundational (blocks every story)", true),
  card("f1", 4, "verifying"), card("f1", 5, "proposing"), card("f1", 6, "queued"),
], { f1: featureDetail(run) });

test("every lane header carries its card count; an empty lane beside a filled one is a rail", () => {
  const nodes = flatten(boardTree(live));
  const columns = nodes.filter((n) => n.tag === "section" && n.attrs["data-lane"] !== undefined);
  const counts = Object.fromEntries(columns.map((c) => [c.attrs["data-lane"], byClass(flatten(c), "column-count")[0]!.text]));
  assert.deepEqual(counts, { queued: "1", proposing: "1", verifying: "1", reviewing: "1", approved: "2", blocked: "0", paused: "0", failed: "0" });
  const rails = columns.filter((c) => c.attrs["data-empty"] === "true").map((c) => c.attrs["data-lane"]);
  assert.deepEqual(rails, ["blocked", "paused", "failed"]);
});

test("a board with no card at all folds no lane to a rail", () => {
  const nodes = flatten(boardTree(view([])));
  assert.ok(!nodes.some((n) => n.attrs["data-empty"] !== undefined), "no rails without a filled lane");
  assert.equal(nodes.filter((n) => n.attrs["data-summary"] !== undefined).length, 0, "no run strip without cards");
});

test("a titled phase card splits into the phase token and the title, the full line as title", () => {
  const node = cardNode(card("f1", 2, "approved", "Foundational (blocks every story)"));
  assert.deepEqual(node.children.map((c) => [c.attrs["data-card-part"], c.text]), [["phase", "2"], ["title", "Foundational (blocks every story)"]]);
  assert.equal(node.children[1]!.attrs["title"], "phase 2 — Foundational (blocks every story)");
  assert.deepEqual(Object.keys(node.attrs).sort(), ["data-card-id", "data-feature", "data-lane", "data-rule-id"], "the card itself keeps its four attributes");
});

test("the run strip: one chip per lane with its count, and the feature's progress, segments and run line", () => {
  const nodes = flatten(boardTree(live));
  const strip = nodes.find((n) => n.attrs["data-summary"] !== undefined)!;
  assert.ok(strip, "the strip renders");
  const chips = byClass(flatten(strip), "summary-chip");
  assert.deepEqual(chips.map((c) => [c.attrs["data-tint"], byClass(flatten(c), "summary-count")[0]!.text, c.attrs["data-empty"] ?? ""]), [
    ["queued", "1", ""], ["proposing", "1", ""], ["verifying", "1", ""], ["reviewing", "1", ""],
    ["approved", "2", ""], ["blocked", "0", "true"], ["paused", "0", "true"], ["failed", "0", "true"],
  ]);
  for (const chip of chips) assert.equal(chip.attrs["data-lane"], undefined, "only columns and cards carry data-lane");
  const row = byClass(flatten(strip), "summary-row")[0]!;
  assert.equal(byClass(flatten(row), "summary-feature")[0]!.text, "f1");
  assert.equal(byClass(flatten(row), "summary-progress")[0]!.text, "2 of 6 approved");
  assert.deepEqual(byClass(flatten(row), "summary-seg").map((s) => s.attrs["data-tint"]), ["approved", "approved", "reviewing", "verifying", "proposing", "queued"]);
  assert.equal(byClass(flatten(row), "summary-track")[0]!.attrs["aria-hidden"], "true", "the segments are decorative");
  assert.equal(byClass(flatten(row), "summary-run")[0]!.text, "run-f10a1dfe · crash · phase 10 · last event 11-09 09:27:02Z");
});

test(`the run strip shows at most ${SUMMARY_FEATURES} features, in first-appearance order, and counts the rest`, () => {
  const features = ["f6", "f2", "f5", "f1", "f4", "f3"];
  const strip = flatten(boardTree(view(features.map((f) => card(f, 1, "queued"))))).find((n) => n.attrs["data-summary"] !== undefined)!;
  assert.deepEqual(byClass(flatten(strip), "summary-feature").map((n) => n.text), features.slice(0, SUMMARY_FEATURES));
  assert.equal(byClass(flatten(strip), "summary-more")[0]!.text, "and 2 more features");
});

test("the inspector sits beside the lanes, carries the card's lane, and titles the phase", () => {
  const root = boardTree(live, { selectedId: "f1#2" });
  const body = byClass(flatten(root), "body")[0]!;
  assert.deepEqual(body.children.map((c) => c.attrs["class"]), [`${P}-lanes`, `${P}-detail`]);
  const aside = body.children[1]!;
  assert.equal(aside.attrs["data-lane"], "approved");
  assert.equal(flatten(aside).find((n) => n.attrs["data-detail-title"] !== undefined)!.text, "Phase 2 — Foundational (blocks every story)");
  assert.ok(textOf(byClass(flatten(aside), "detail-meta")[0]!).includes("f1"), "the feature is named in the header");
  const selected = flatten(root).find((n) => n.attrs["data-selected"] === "true")!;
  assert.equal(selected.attrs["data-card-id"], "f1#2");
});

test("banners stay direct children of the board root", () => {
  const dead = { ...live, conditions: { dead: true, stale: null, launchAbandoned: false } } as ReadView;
  const root = boardTree(dead);
  assert.ok(root.children.some((c) => c.attrs["role"] === "status"));
});

test("the run strip leads with the feature being run, then the newest run, then features never run", () => {
  const at = (iso: string, state: string): FeatureDetail => featureDetail({ id: `run-${iso}`, launch: null, state, phase: 1, startedAt: null, lastAt: iso });
  const v = view(["f100", "f101", "f102", "f152", "f105"].map((f) => card(f, 1, "approved")), {
    f101: at("2026-11-08T10:00:00.000Z", "approved"),
    f105: at("2026-11-09T09:00:00.000Z", "lost"),
    f152: at("2026-11-09T08:00:00.000Z", "running"),
  });
  const strip = flatten(boardTree(v)).find((n) => n.attrs["data-summary"] !== undefined)!;
  assert.deepEqual(byClass(flatten(strip), "summary-feature").map((n) => n.text), ["f152", "f105", "f101", "f100"]);
  assert.equal(byClass(flatten(strip), "summary-more")[0]!.text, "and 1 more feature");
});
