/**
 * T033 — PT-121-014 (F121-FR-014; engine F129-FR-035): unknown members.
 *
 * A lane, attention kind or budget level the presentation table does not know
 * renders as text with the glyph `?` and never stops the board:
 *  - an unknown lane becomes a trailing column titled with the raw value; its
 *    cards keep their own `data-lane` (the plugin derives no lane) and are not
 *    moved to any other column;
 *  - an unknown attention kind renders its row in place with `?` and the raw
 *    value as the label;
 *  - an unknown budget level renders its row in place with `?` and the raw
 *    value as the label;
 *  - every other lane, kind and level of each fixture still renders.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { boardTree, DEFAULT_PREFIX, type Node as TreeNode } from "../../src/shared/board-tree.ts";
import { acceptView, type ReadView } from "../../src/shared/view-read.ts";
import {
  ATTENTION_PRESENTATION_UNKNOWN,
  ATTENTION_PRESENTATION,
  BUDGET_PRESENTATION,
  BUDGET_PRESENTATION_UNKNOWN,
  LANES,
  LANE_PRESENTATION_UNKNOWN,
} from "../../src/shared/generated/contract-values.ts";

const viewsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "views");

const read = (name: string): unknown => JSON.parse(readFileSync(join(viewsDir, `${name}.json`), "utf8")) as unknown;
const readView = (name: string): ReadView => {
  const result = acceptView(read(name));
  assert.ok(result.ok, `${name} is accepted by acceptView`);
  return (result as { ok: true; view: ReadView }).view;
};

function flatten(node: TreeNode): TreeNode[] {
  return [node, ...node.children.flatMap(flatten)];
}

function badgesOf(node: TreeNode): TreeNode[] {
  return flatten(node).filter((n) => n.attrs["class"] === `${DEFAULT_PREFIX}-badge`);
}

/* ------------------------------ unknown lane ------------------------------ */

const laneView = readView("unknown-lane");
const laneTree = boardTree(laneView);
const laneNodes = flatten(laneTree);

test("unknown-lane: a trailing column is titled with the raw value and carries the ? unknown presentation", () => {
  const columns = laneNodes.filter((n) => n.attrs["data-unknown-lane"] === "true");
  assert.equal(columns.length, 1, "exactly one unknown-lane column");
  const column = columns[0]!;
  assert.equal(column.attrs["data-lane"], "quarantine", "the column is bound to the raw lane value");
  assert.ok(column.attrs["aria-label"]?.includes("quarantine"), "the column's aria-label names the raw lane");

  const header = column.children.find((n) => n.attrs["class"] === `${DEFAULT_PREFIX}-column-header`);
  assert.ok(header, "the column has a header");
  const badge = badgesOf(header as TreeNode)[0]!;
  assert.equal(badge.text, LANE_PRESENTATION_UNKNOWN.glyph, "the header badge's glyph is ?");
  assert.equal(badge.attrs["aria-label"], "quarantine", "the header badge's label is the raw lane value");
  assert.equal(badge.attrs["data-gray"], String(LANE_PRESENTATION_UNKNOWN.grayscale), "the header badge carries the unknown grayscale");
});

test("unknown-lane: the unknown lane's cards sit in the trailing column and were not moved", () => {
  const unknownCards = laneView.cards.filter((card) => card.lane === "quarantine");
  assert.ok(unknownCards.length > 0, "the fixture has a card on the unknown lane");
  const columns = laneNodes.filter((n) => n.attrs["data-unknown-lane"] === "true");
  const column = columns[0]!;
  const columnText = JSON.stringify(column);
  for (const card of unknownCards) {
    assert.ok(columnText.includes(`"data-card-id":"${card.id}"`), `card ${card.id} is inside the unknown-lane column`);
  }
  // No card was moved: every card of the view keeps its own lane in its data attributes.
  for (const card of laneView.cards) {
    const cardNode = laneNodes.find((n) => n.attrs["data-card-id"] === card.id);
    assert.ok(cardNode, `card ${card.id} renders`);
    assert.equal(cardNode!.attrs["data-lane"], card.lane, `card ${card.id} keeps its own lane`);
  }
  // Each of the engine's eight lanes still has its own column (nothing merged away).
  for (const lane of LANES) {
    assert.ok(laneNodes.some((n) => n.attrs["data-lane"] === lane), `lane ${lane} still has its column`);
  }
});

test("unknown-lane: the known lanes' header badges still hit the presentation table", () => {
  for (const lane of LANES) {
    const column = laneNodes.find((n) => n.attrs["data-lane"] === lane);
    const badge = badgesOf(column as TreeNode)[0]!;
    assert.ok(badge.text.length > 0 && badge.text !== "?", `lane ${lane} keeps its known glyph`);
    assert.ok(badge.attrs["aria-label"] !== undefined && badge.attrs["aria-label"] !== "", `lane ${lane} keeps a label`);
  }
});

/* ---------------------------- unknown attention kind ---------------------------- */

const kindView = readView("unknown-kind");
const kindTree = boardTree(kindView);
const kindNodes = flatten(kindTree);

test("unknown-kind: the unknown kind renders in place with ?, the raw label and the unknown grayscale", () => {
  const section = kindNodes.find((n) => n.attrs["data-attention"] !== undefined);
  assert.ok(section, "the attention section renders");
  const sectionNodes = flatten(section as TreeNode);
  const unknownRows = sectionNodes.filter((n) => n.attrs["data-kind"] === "quantum-drift");
  assert.ok(unknownRows.length > 0, "a row carries the raw unknown kind");
  const badge = badgesOf(unknownRows[0]!)[0]!;
  assert.equal(badge.text, ATTENTION_PRESENTATION_UNKNOWN.glyph, "the unknown kind's glyph is ?");
  assert.equal(badge.attrs["aria-label"], "quantum-drift", "the unknown kind's label is the raw value");
  assert.equal(badge.attrs["data-gray"], String(ATTENTION_PRESENTATION_UNKNOWN.grayscale), "the unknown kind carries the unknown grayscale");
});

test("unknown-kind: the known kinds still render their rows with their table presentation", () => {
  const section = kindNodes.find((n) => n.attrs["data-attention"] !== undefined)!;
  const sectionNodes = flatten(section);
  for (const row of kindView.attention) {
    const rowNodes = sectionNodes.filter((n) => n.attrs["data-kind"] === row.kind);
    assert.ok(rowNodes.length > 0, `kind ${row.kind} still renders`);
    const badge = badgesOf(rowNodes[0]!)[0]!;
    const known = ATTENTION_PRESENTATION[row.kind as keyof typeof ATTENTION_PRESENTATION];
    if (known) {
      assert.equal(badge.text, known.glyph, `kind ${row.kind} keeps its table glyph`);
      assert.equal(badge.attrs["aria-label"], known.label, `kind ${row.kind} keeps its table label`);
    }
  }
});

/* ------------------------------ unknown budget level ------------------------------ */

const levelView = readView("unknown-level");
const levelTree = boardTree(levelView);
const levelNodes = flatten(levelTree);

test("unknown-level: the unknown level renders in place with ?, the raw label and the unknown grayscale", () => {
  const section = levelNodes.find((n) => n.attrs["data-budget"] !== undefined);
  assert.ok(section, "the budget section renders");
  const sectionNodes = flatten(section as TreeNode);
  const unknownRows = sectionNodes.filter((n) => n.attrs["data-level"] === "critical");
  assert.ok(unknownRows.length > 0, "a row carries the raw unknown level");
  const badge = badgesOf(unknownRows[0]!)[0]!;
  assert.equal(badge.text, BUDGET_PRESENTATION_UNKNOWN.glyph, "the unknown level's glyph is ?");
  assert.equal(badge.attrs["aria-label"], "critical", "the unknown level's label is the raw value");
  assert.equal(badge.attrs["data-gray"], String(BUDGET_PRESENTATION_UNKNOWN.grayscale), "the unknown level carries the unknown grayscale");
});

test("unknown-level: the known levels still render their rows with their table presentation", () => {
  const section = levelNodes.find((n) => n.attrs["data-budget"] !== undefined)!;
  const sectionNodes = flatten(section);
  for (const row of levelView.budget) {
    const rowNodes = sectionNodes.filter((n) => n.attrs["data-level"] === row.level);
    assert.ok(rowNodes.length > 0, `level ${row.level} still renders`);
    const badge = badgesOf(rowNodes[0]!)[0]!;
    const known = BUDGET_PRESENTATION[row.level as keyof typeof BUDGET_PRESENTATION];
    if (known) {
      assert.equal(badge.text, known.glyph, `level ${row.level} keeps its table glyph`);
      assert.equal(badge.attrs["aria-label"], known.label, `level ${row.level} keeps its table label`);
    }
  }
});

/* ------------------------- the board does not stop ------------------------- */

test("an unknown member never stops the board: every renderable fixture yields a full board", () => {
  const index = JSON.parse(readFileSync(join(viewsDir, "index.json"), "utf8")) as {
    valid: string[];
    unknownMember: Record<string, { path: string | null }>;
  };
  let count = 0;
  for (const [name, meta] of Object.entries(index.unknownMember)) {
    if (meta.path === null) continue; // schema-level refusals are not views
    const result = acceptView(read(name));
    if (!result.ok) continue;
    const tree = boardTree((result as { ok: true; view: ReadView }).view);
    assert.equal(tree.attrs["data-kanban"], "", `${name}: the board renders`);
    const cardCount = flatten(tree).filter((n) => n.attrs["data-card-id"] !== undefined).length;
    assert.equal(cardCount, (result as { ok: true; view: ReadView }).view.cards.length, `${name}: every card renders`);
    count += 1;
  }
  assert.ok(count >= 3, "the unknown-lane, unknown-kind and unknown-level fixtures rendered");
});
