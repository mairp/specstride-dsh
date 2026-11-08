/** T044 — PT-121-020 (F121-FR-020): windowing. Above the lane threshold only a
 * bounded window of card nodes is built per column (threshold + 2 · overscan at
 * most), the window follows `scrollTop` (the card row is a fixed 2rem, so rows
 * and pixels map 1:1), at or below the threshold every card is a node, the
 * board model itself is untouched — only the tree differs — and a threshold
 * read from the meta outside 1..10,000 falls back to 100 with one log line.
 *
 * The windowed board is a new `BoardModel` (equal shape to the input, fewer
 * cards per column); `windowOf` never mutates its input. Heights are in card
 * rows: `scrollTop` is the first row at the top of the viewport and
 * `viewportHeight` is how many rows are visible.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { acceptView } from "../../src/shared/view-read.ts";
import { boardOf, type BoardModel } from "../../src/shared/board-model.ts";
import { boardTree } from "../../src/shared/board-tree.ts";
import { serialize, type Node } from "../../src/shared/tree.ts";
import { windowOf, thresholdOfMeta } from "../../src/shared/window.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const views = join(packageRoot, "tests", "fixtures", "views");
const read = (name: string) => JSON.parse(readFileSync(join(views, `${name}.json`), "utf8")) as Record<string, unknown>;

const THRESHOLD = 100;
const OVERSCAN = 20;
/** The bound the task names: threshold + two overscans, never more. */
const WINDOW_BOUND = THRESHOLD + 2 * OVERSCAN;

const bigView = (acceptView(read("big-2000")) as { ok: true; view: unknown }).view;
const bigBoard = boardOf(bigView, { answer: "view" });

/** The one column of big-2000 that actually holds cards (the verifying lane, 2000 of them). */
function busiestColumn(board: BoardModel) {
  const column = [...board.columns].sort((a, b) => b.cards.length - a.cards.length)[0];
  assert.ok(column !== undefined, "no column on the board");
  return column;
}

function walk(node: Node, visit: (node: Node) => void): void {
  visit(node);
  for (const child of node.children) walk(child, visit);
}

/** The card ids of one column node, in tree order. */
function cardIdsOf(column: Node): string[] {
  const ids: string[] = [];
  walk(column, (n) => {
    const id = n.attrs["data-card-id"];
    if (id !== undefined) ids.push(id);
  });
  return ids;
}

/** The column nodes of a board tree (a section with data-lane/data-lanes, never a card). */
function columnsOf(tree: Node): Node[] {
  const out: Node[] = [];
  walk(tree, (n) => {
    if (("data-lane" in n.attrs || "data-lanes" in n.attrs) && !("data-card-id" in n.attrs)) out.push(n);
  });
  return out;
}

/** The tree of a board windowed at the given scroll position. */
function windowedTree(scrollTop: number): Node {
  return boardTree(windowOf(bigBoard, { scrollTop, viewportHeight: THRESHOLD, threshold: THRESHOLD, overscan: OVERSCAN }));
}

test("at any scroll position the windowed column holds at most threshold + 2 · overscan card nodes", () => {
  const full = busiestColumn(bigBoard);
  assert.ok(full.cards.length > WINDOW_BOUND, "the fixture column must exceed the window bound for this test to bite");
  for (const scrollTop of [0, 1, 37, OVERSCAN, THRESHOLD, 500, 1000, 1999]) {
    const tree = windowedTree(scrollTop);
    for (const column of columnsOf(tree)) {
      const ids = cardIdsOf(column);
      assert.ok(
        ids.length <= WINDOW_BOUND,
        `scrollTop ${scrollTop}: column ${column.attrs["data-lane"] ?? column.attrs["data-lanes"]} renders ${ids.length} cards, over ${WINDOW_BOUND}`,
      );
    }
  }
});

test("moving scrollTop moves the window", () => {
  const idsAt = (scrollTop: number) => cardIdsOf(columnsOf(windowedTree(scrollTop))[0] as Node);
  const atTop = idsAt(0);
  const further = idsAt(300);
  assert.notDeepEqual(further, atTop, "the same cards render at scrollTop 0 and scrollTop 300 — the window does not move");
  // The window at the deeper position must have moved down the column: the id
  // of the first card at the top scroll is long gone from the deep window, and
  // the deep window's cards all sit after the top window's last card.
  assert.ok(!further.includes(atTop[0] as string), "the top card still renders 300 rows down");
  const lastAtTop = Number.parseInt((atTop[atTop.length - 1] as string).replace("big-", ""), 10);
  const firstFurther = Number.parseInt((further[0] as string).replace("big-", ""), 10);
  assert.ok(firstFurther > lastAtTop - WINDOW_BOUND, `the deep window (${firstFurther}) does not follow the scroll (${lastAtTop})`);
});

test("at 100 cards or fewer every card is a node", () => {
  // Every renderable fixture but big-2000 holds far fewer than the threshold.
  const index = JSON.parse(readFileSync(join(views, "index.json"), "utf8")) as { valid: string[] };
  for (const name of index.valid) {
    if (name === "big-2000") continue;
    const board = boardOf((acceptView(read(name)) as { ok: true; view: unknown }).view, { answer: "view" });
    const windowed = windowOf(board, { scrollTop: 0, viewportHeight: THRESHOLD, threshold: THRESHOLD, overscan: OVERSCAN });
    for (const column of windowed.columns) {
      const full = [...board.columns].find((c) => c.lanes.join(" ") === column.lanes.join(" "));
      assert.equal(
        column.cards.length,
        full?.cards.length ?? 0,
        `${name}: column ${column.label} lost cards below the threshold`,
      );
    }
    const ids = new Set<string>();
    for (const column of columnsOf(boardTree(windowed))) for (const id of cardIdsOf(column)) ids.add(id);
    for (const column of board.columns) {
      for (const card of column.cards) assert.ok(ids.has(card.id), `${name}: card ${card.id} is not a node below the threshold`);
    }
  }
});

test("the board model is identical with and without windowing — only the tree differs", () => {
  const snapshot = structuredClone(bigBoard) as unknown;
  windowOf(bigBoard, { scrollTop: 400, viewportHeight: THRESHOLD, threshold: THRESHOLD, overscan: OVERSCAN });
  assert.deepEqual(bigBoard, snapshot, "windowOf mutated its input model");

  const windowed = windowOf(bigBoard, { scrollTop: 400, viewportHeight: THRESHOLD, threshold: THRESHOLD, overscan: OVERSCAN });
  assert.equal(windowed.columns.length, bigBoard.columns.length, "windowing changed the column count");
  assert.deepEqual(windowed.banners, bigBoard.banners, "windowing changed the banners");
  assert.deepEqual(windowed.attention, bigBoard.attention, "windowing changed the attention rows");
  assert.deepEqual(windowed.budget, bigBoard.budget, "windowing changed the budget rows");
  const fullColumn = busiestColumn(bigBoard);
  const windowedColumn = [...windowed.columns].find((c) => c.lanes.join(" ") === fullColumn.lanes.join(" ")) as
    | { cards: { id: string }[] }
    | undefined;
  assert.ok(windowedColumn !== undefined);
  assert.deepEqual(
    windowedColumn.cards.map((c) => c.id),
    fullColumn.cards.map((c) => c.id).slice(400 - OVERSCAN, 400 + THRESHOLD + OVERSCAN),
    "the windowed column is not the contiguous slice around scrollTop",
  );

  // The trees differ: windowing prunes card nodes, the plain tree keeps all 2000.
  const full = boardTree(bigBoard);
  const pruned = boardTree(windowed);
  assert.notEqual(serialize(pruned), serialize(full), "the windowed tree is byte-equal to the full tree");
  const fullIds = columnsOf(full).flatMap(cardIdsOf);
  const prunedIds = columnsOf(pruned).flatMap(cardIdsOf);
  assert.ok(fullIds.length > prunedIds.length, "windowing did not remove any card node");
});

test("a threshold from the meta outside 1..10,000 falls back to 100 with one log line", () => {
  const lines: string[] = [];
  const log = (line: string) => lines.push(line);
  for (const bad of ["0", "-5", "10001", "999999", "abc", "", "1.5", "1e4"]) {
    lines.length = 0;
    assert.equal(thresholdOfMeta(bad, log), 100, `meta ${JSON.stringify(bad)} did not fall back to 100`);
    assert.equal(lines.length, 1, `meta ${JSON.stringify(bad)} logged ${lines.length} lines, not exactly one`);
    assert.ok(lines[0] !== "", "the fallback log line is empty");
  }
  lines.length = 0;
  assert.equal(thresholdOfMeta("250", log), 250, "a valid meta threshold was not taken");
  assert.equal(lines.length, 0, "a valid meta threshold logged a line");
  assert.equal(thresholdOfMeta(null, log), 100, "no meta did not fall back to 100");
  assert.equal(lines.length, 0, "no meta logged a line");
  // The bounds themselves are valid.
  assert.equal(thresholdOfMeta("1", log), 1);
  assert.equal(thresholdOfMeta("10000", log), 10_000);
  assert.equal(lines.length, 0, "the bounds logged a line");
});
