/** T013 — PT-121-006 (F121-FR-006): the board derives no lane; merge and hide change display only. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { boardOf } from "../../src/shared/board-model.ts";
import { scanTree } from "../../scripts/scan.ts";
import { LANES } from "../../src/shared/generated/contract-values.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const view = JSON.parse(
  readFileSync(join(packageRoot, "tests", "fixtures", "views", "blocked-card.json"), "utf8"),
) as Record<string, unknown>;

type Card = {
  id: string;
  lane: string;
  ruleId: string;
  feature: string | null;
  node: { attrs: Record<string, string> };
};
type Column = { lanes: readonly string[]; label: string; cards: readonly Card[] };
type Board = { columns: readonly Column[] };

const columnsOf = (board: Board) => board.columns;
const columnFor = (board: Board, lane: string): Column => {
  const column = board.columns.find((candidate) => candidate.lanes.includes(lane));
  assert.ok(column, `no column holds ${lane}`);
  return column;
};
const attrsOf = (card: Card) => card.node.attrs;

test("a card sits on the column named by its own lane (blocked-card stays on blocked)", () => {
  const board = boardOf(view, {}) as Board;
  const blocked = columnFor(board, "blocked");
  assert.deepEqual(blocked.cards.map((card) => card.id), ["c-1"]);
  for (const lane of LANES) {
    if (lane === "blocked") continue;
    const column = columnsOf(board).find((candidate) => candidate.lanes.includes(lane));
    assert.ok(column, `lane ${lane} has a column`);
    assert.deepEqual(column.cards.map((card) => card.id), [], `lane ${lane} is empty`);
  }
  assert.equal(attrsOf(blocked.cards[0]!)["data-lane"], "blocked");
  assert.equal(attrsOf(blocked.cards[0]!)["data-rule-id"], "L-06");
  assert.equal(attrsOf(blocked.cards[0]!)["data-card-id"], "c-1");
});

test("mutating every card field but lane moves no card", () => {
  const mutated = JSON.parse(JSON.stringify(view)) as Record<string, unknown>;
  const cards = (mutated["cards"] as Record<string, unknown>[]).map((card) => ({
    ...card,
    id: "moved?",
    phase: 99,
    ruleId: "L-01",
    feature: "other-feature",
    flags: { dead: true, stale: true, yielded: false },
  }));
  mutated["cards"] = cards;
  mutated["state"] = "reviewing";
  mutated["display"] = "reviewing";
  mutated["transition"] = "T-9";
  mutated["stateSince"] = "2026-11-08T00:00:00.000Z";
  mutated["liveness"] = "dead";
  mutated["lanes"] = (mutated["lanes"] as Record<string, unknown>[]).map((entry) =>
    entry["lane"] === "blocked" ? { lane: "blocked", cards: [] } : entry,
  );
  const board = boardOf(mutated, {}) as Board;
  const blocked = columnFor(board, "blocked");
  assert.deepEqual(
    blocked.cards.map((card) => attrsOf(card)["data-lane"]),
    ["blocked"],
    "the card is still on blocked — the column comes from card.lane only",
  );
  assert.deepEqual(
    board.columns
      .filter((column) => !column.lanes.includes("blocked"))
      .flatMap((column) => column.cards.map((card) => card.id)),
    [],
    "no other column gained a card",
  );
});

test("a consumer merge [\"approved\",\"failed\"] gives one column naming both lanes, cards keeping their own data-lane and data-rule-id", () => {
  const board = boardOf(view, { merge: [["approved", "failed"]] }) as Board;
  const merged = board.columns.filter((column) => column.lanes.length > 1);
  assert.equal(merged.length, 1, "exactly one merged column");
  const column = merged[0]!;
  assert.deepEqual(column.lanes, ["approved", "failed"]);
  for (const lane of ["approved", "failed"]) {
    assert.ok(
      column.label.includes(lane),
      `the merged header names ${lane} (label: ${column.label})`,
    );
  }
  // the eight lanes still each appear exactly once across the columns, plus the merge accounted for
  const held = board.columns.flatMap((entry) => [...entry.lanes]).sort();
  assert.deepEqual(held, [...LANES].sort(), "every lane is held by exactly one column");
  // the merged column is empty here, but placement keeps the lane order
  assert.deepEqual(
    board.columns.map((column) => column.lanes[0]),
    ["queued", "proposing", "verifying", "reviewing", "approved", "blocked", "paused"],
    "the merged column sits where its first lane sat; nothing is re-ordered",
  );
  assert.equal(columnFor(board, "blocked").cards.length, 1);
});

test("merge with cards on both lanes keeps each card's own data-lane and data-rule-id", () => {
  const both = JSON.parse(JSON.stringify(view)) as Record<string, unknown>;
  const cards = both["cards"] as Record<string, unknown>[];
  cards.push({ id: "c-2", feature: "121-dsh-kanban", phase: 4, lane: "failed", ruleId: "L-08", flags: { dead: true, stale: false, yielded: false } });
  (both["lanes"] as Record<string, unknown>[]).find((entry) => entry["lane"] === "failed")!["cards"] = ["c-2"];
  const board = boardOf(both, { merge: [["approved", "failed"]] }) as Board;
  const column = columnFor(board, "failed");
  assert.equal(column, columnFor(board, "approved"));
  // F121-FR-006: a card sits on the column named by its own lane — c-1's lane is
  // `blocked`, so it stays on the blocked column even when approved+failed merge.
  assert.deepEqual(column.cards.map((card) => card.id), ["c-2"]);
  const blocked = columnFor(board, "blocked");
  assert.deepEqual(blocked.cards.map((card) => card.id), ["c-1"]);
  assert.deepEqual(attrsOf(blocked.cards[0]!), {
    "data-card-id": "c-1",
    "data-lane": "blocked",
    "data-rule-id": "L-06",
    "data-feature": "121-dsh-kanban",
  });
  assert.equal(attrsOf(column.cards[0]!)["data-lane"], "failed");
  assert.equal(attrsOf(column.cards[0]!)["data-rule-id"], "L-08");
});

test("hiding a lane hides its column only: no card moves, other columns are untouched", () => {
  const both = JSON.parse(JSON.stringify(view)) as Record<string, unknown>;
  (both["cards"] as Record<string, unknown>[]).push({ id: "c-2", feature: "121-dsh-kanban", phase: 4, lane: "failed", ruleId: "L-08", flags: { dead: true, stale: false, yielded: false } });
  (both["lanes"] as Record<string, unknown>[]).find((entry) => entry["lane"] === "failed")!["cards"] = ["c-2"];
  const plain = boardOf(both, {}) as Board;
  const hidden = boardOf(both, { hide: ["blocked"] }) as Board;
  assert.ok(
    !hidden.columns.some((column) => column.lanes.includes("blocked")),
    "the blocked column is gone",
  );
  assert.equal(hidden.columns.length, plain.columns.length - 1, "only that column is gone");
  assert.deepEqual(
    hidden.columns.filter((column) => !column.lanes.includes("blocked")).map((column) => column.lanes),
    plain.columns.filter((column) => !column.lanes.includes("blocked")).map((column) => column.lanes),
  );
  const failed = columnFor(hidden, "failed");
  assert.deepEqual(failed.cards.map((card) => card.id), ["c-2"], "no card of a visible lane moved or vanished");
  assert.equal(attrsOf(failed.cards[0]!)["data-lane"], "failed");
  assert.equal(
    hidden.columns.flatMap((column) => column.cards.map((card) => card.id)).includes("c-1"),
    false,
    "the hidden lane's card is shown nowhere",
  );
});

test("the scan rule (a) of T008 holds on src/ — no lane assignment anywhere outside the generated keys", () => {
  const findings = scanTree(packageRoot).filter((finding) => finding.rule === "no-lane-assignment");
  assert.deepEqual(
    findings.map((finding) => `${finding.file}:${finding.line} ${finding.detail}`),
    [],
    "no lane is assigned and columnOf reads card.lane only",
  );
});
