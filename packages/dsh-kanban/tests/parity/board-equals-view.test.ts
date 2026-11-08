/** T012 — parity of the board model with the RunView (PT-121-005, PT-121-008; F121-FR-005, F121-FR-008, F121-SC-001).
 *
 * The board model is a pure projection of the accepted view. For every valid
 * fixture view (T009's index) the builders produce exactly
 *
 *  - `columns`: the eight lanes of row 243 in their pinned order — empty lanes
 *    included as empty columns — followed by one trailing column per unknown
 *    lane value, in first-appearance order (F121-FR-005, F121-FR-014);
 *  - the set of `(cardId, lane, ruleId)` on the board equals the view's `cards`,
 *    each card exactly once; an unknown lane keeps its raw value (the card is
 *    not moved, F121-FR-014);
 *  - inside each column the cards follow `view.lanes[].cards` (F121-FR-008),
 *    grouped by feature — one group per feature, ordered by first appearance in
 *    that lane's view order, `null` feature its own group;
 *  - `empty-run` and the `no-run` answer render the eight empty lanes and the
 *    one "No run" line, exactly once (F121-SC-001).
 *
 * Module contract this test pins for `src/shared/board-model.ts`:
 *
 *    buildColumns(view: ReadView): BoardColumn[]
 *    buildBoard(view: ReadView): Board
 *    BoardColumn = { lane: string | null, groups: { feature: string | null, cards: BoardCard[] }[] }
 *    BoardCard   = { cardId: string, lane: string, ruleId: string, feature: string | null, phase: number | null }
 *    Board       = { columns: BoardColumn[], notes: string[] }
 *
 * The builders read nothing from disk: the fixture views are loaded from a
 * throwaway copy, the copy's directory is then deleted, and the builders run
 * afterwards on the loaded objects alone — no file handle, no lazy read.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { acceptView, type ReadView } from "../../src/shared/view-read.ts";
import { LANES } from "../../src/shared/generated/contract-values.ts";
import { buildBoard, buildColumns } from "../../src/shared/board-model.ts";

const here = dirname(fileURLToPath(import.meta.url));
const viewsDir = join(here, "..", "fixtures", "views");

type Named = { name: string; view: ReadView };

/** Load every valid fixture view from a throwaway copy of the fixture views,
 * then delete that copy before any builder runs. */
function loadAllThenDelete(): Named[] {
  const copy = join(mkdtempSync(join(tmpdir(), "parity-board-")), "views");
  cpSync(viewsDir, copy, { recursive: true });
  const index = JSON.parse(readFileSync(join(copy, "index.json"), "utf8")) as { valid: string[] };
  const views = index.valid.map((name) => {
    const raw = JSON.parse(readFileSync(join(copy, `${name}.json`), "utf8")) as Record<string, unknown>;
    const result = acceptView(raw);
    assert.equal(result.ok, true, `${name} is accepted`);
    return { name, view: (result as { ok: true; view: ReadView }).view };
  });
  rmSync(dirname(copy), { recursive: true, force: true });
  assert.equal(existsSync(copy), false, "the fixture directory is gone before the builders run");
  return views;
}

// Loaded once, at module scope: from here on the fixture directory does not exist.
const FIXTURES: Named[] = loadAllThenDelete();

type BoardCard = { cardId: string; lane: string; ruleId: string; feature: string | null; phase: number | null };
type BoardColumn = { lane: string | null; groups: { feature: string | null; cards: BoardCard[] }[] };
type Board = { columns: BoardColumn[]; notes: string[] };

test("the columns are the eight lanes of row 243 in order, empty ones included, then the unknown lanes", () => {
  assert.deepEqual([...LANES], ["queued", "proposing", "verifying", "reviewing", "approved", "blocked", "paused", "failed"]);
  for (const { name, view } of FIXTURES) {
    const columns = buildColumns(view) as BoardColumn[];
    assert.ok(columns.length >= LANES.length, `${name}: at least the eight columns`);
    assert.deepEqual(
      columns.slice(0, LANES.length).map((c) => c.lane),
      [...LANES],
      `${name}: the eight lanes in order, empty ones included`,
    );
    const known = new Set<string>(LANES);
    const expectedUnknown = [...new Set(view.cards.map((c) => c.lane).filter((lane) => !known.has(lane)))];
    assert.deepEqual(
      columns.slice(LANES.length).map((c) => c.lane),
      expectedUnknown,
      `${name}: one trailing column per unknown lane, in first-appearance order`,
    );
  }
});

test("the set of (cardId, lane, ruleId) on the board equals the view's cards; unknown lanes are not moved", () => {
  for (const { name, view } of FIXTURES) {
    const board = buildBoard(view) as Board;
    const onBoard: [string, string, string][] = board.columns.flatMap((column) =>
      column.groups.flatMap((group) => group.cards.map((card) => [card.cardId, card.lane, card.ruleId] as [string, string, string])),
    );
    const inView: [string, string, string][] = view.cards.map((card) => [card.id, card.lane, card.ruleId]);
    assert.equal(onBoard.length, inView.length, `${name}: each card appears exactly once`);
    assert.deepEqual([...onBoard].sort(), [...inView].sort(), `${name}: same (cardId, lane, ruleId) set`);
    if (name === "unknown-lane") {
      const column = board.columns.slice(LANES.length).find((c) => c.lane === "quarantine");
      assert.ok(column, "the raw unknown lane has its own trailing column");
      assert.deepEqual(
        column!.groups.flatMap((group) => group.cards.map((card) => card.cardId)),
        ["c-2"],
        "the card is shown in the unknown column, not moved",
      );
    }
  }
});

test("card order inside each column follows view.lanes[].cards, grouped by feature", () => {
  for (const { name, view } of FIXTURES) {
    const byId = new Map(view.cards.map((card) => [card.id, card]));
    const board = buildBoard(view) as Board;
    for (const column of board.columns) {
      const laneOrder = view.lanes.find((lane) => lane.lane === column.lane)?.cards ?? [];
      // The contract's order: view order, regrouped by feature — first appearance
      // first, the null-feature group last (contracts/presentation.md).
      const firstAppearance: (string | null)[] = [];
      const byFeature = new Map<string | null, string[]>();
      for (const id of laneOrder) {
        const feature = byId.get(id)?.feature ?? null;
        if (!byFeature.has(feature)) {
          byFeature.set(feature, []);
          if (feature !== null) firstAppearance.push(feature);
        }
        (byFeature.get(feature) as string[]).push(id);
      }
      const expected: string[] = [
        ...firstAppearance.map((feature) => byFeature.get(feature) as string[]),
        ...(byFeature.has(null) ? [byFeature.get(null) as string[]] : []),
      ].flat();
      assert.deepEqual(
        column.groups.flatMap((group) => group.cards.map((card) => card.cardId)),
        expected,
        `${name}/${String(column.lane)}: the column is the lane's view cards, regrouped by feature`,
      );
      const firstFeature: (string | null)[] = laneOrder.map((id) => byId.get(id)?.feature ?? null);
      const seen: (string | null)[] = [];
      for (const group of column.groups) {
        assert.ok(!seen.includes(group.feature), `${name}/${String(column.lane)}: feature ${String(group.feature)} appears in one group`);
        assert.ok(
          group.cards.every((card) => (byId.get(card.cardId)?.feature ?? null) === group.feature),
          `${name}/${String(column.lane)}: the group holds one feature`,
        );
        seen.push(group.feature);
      }
      const expectedGroups = [...new Set(firstFeature)].filter((feature) => feature !== null);
      if (new Set(firstFeature).has(null)) expectedGroups.push(null);
      assert.deepEqual(seen, expectedGroups, `${name}/${String(column.lane)}: groups by feature, first appearance first, no feature last`);
    }
  }
});

test("empty-run and the no-run answer show the eight empty lanes and the one no-run line, once", () => {
  const emptyRun = FIXTURES.find((entry) => entry.name === "empty-run");
  assert.ok(emptyRun, "empty-run is among the fixtures");
  const board = buildBoard(emptyRun!.view) as Board;
  assert.deepEqual(
    board.columns.slice(0, LANES.length).map((column) => column.lane),
    [...LANES],
    "the eight lanes, in order",
  );
  assert.ok(
    board.columns.slice(0, LANES.length).every((column) => column.groups.every((group) => group.cards.length === 0)),
    "all eight lanes are empty",
  );
  assert.deepEqual(board.notes, ["No run"], `empty-run: exactly one "No run" line`);
  assert.equal(board.notes.filter((note) => note === "No run").length, 1, "the no-run line appears once");
  const noRunView = { ...emptyRun!.view, state: "none", display: "none" } as ReadView;
  const noRunBoard = buildBoard(noRunView) as Board;
  assert.deepEqual(
    noRunBoard.columns.slice(0, LANES.length).map((column) => [column.lane, column.groups.flatMap((g) => g.cards.map((c) => c.cardId))]),
    board.columns.slice(0, LANES.length).map((column) => [column.lane, column.groups.flatMap((g) => g.cards.map((c) => c.cardId))]),
    "the no-run answer shows the same eight empty lanes",
  );
  assert.deepEqual(noRunBoard.notes, ["No run"], "the no-run answer: the same single no-run line");
});

test("buildColumns and buildBoard agree, with the loaded fixture directory deleted", () => {
  assert.equal(existsSync(viewsDir), true, "the repo fixture views are untouched");
  for (const { name, view } of FIXTURES) {
    const board = buildBoard(view) as Board;
    assert.deepEqual(board.columns, buildColumns(view) as BoardColumn[], `${name}: buildBoard.columns === buildColumns(view)`);
  }
});
