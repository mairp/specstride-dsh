/** T015 — characterization of the kept Lisa board behaviours (research.md R10;
 * Lisa `76adfdc`, read-only, never executed). F121-FR-008, F121-FR-009, F121-FR-012, F121-FR-014.
 *
 * Each test names the Lisa lines it characterizes in its title. Kept: canonical
 * lanes always shown with unknowns appended, DOM-free builders, data attributes
 * and `aria-label` on badges. Dropped (owner-ruled 2026-11-06): Lisa's lane set,
 * `stateKeyFor`, the `--lisa-*` palette and `prefers-color-scheme`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LANES } from "../../src/shared/generated/contract-values.ts";
import { acceptView, type ReadView } from "../../src/shared/view-read.ts";
import { boardOf, type BoardModel } from "../../src/shared/board-model.ts";
import { boardTree } from "../../src/shared/board-tree.ts";
import { serialize, type Node } from "../../src/shared/tree.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const views = join(packageRoot, "tests", "fixtures", "views");
const read = (name: string) => JSON.parse(readFileSync(join(views, `${name}.json`), "utf8")) as Record<string, unknown>;
const view = (name: string): ReadView => {
  const result = acceptView(read(name));
  assert.ok(result.ok, `${name} is accepted`);
  return (result as { ok: true; view: ReadView }).view;
};

function walk(node: Node, visit: (node: Node) => void): void {
  visit(node);
  for (const child of node.children) walk(child, visit);
}

test("CT-121-01 (Lisa App.tsx:115-145): canonical lanes always shown, unknown appended after — empty view, eight empty columns in order", () => {
  const board = boardOf(view("empty-run"), { answer: "view" });
  assert.deepEqual(board.columns.map((column) => column.lanes[0]), [...LANES]);
  assert.ok(board.columns.every((column) => column.cards.length === 0));
});

test("CT-121-01 (Lisa App.tsx:115-145): canonical lanes always shown, unknown appended after — unknown lane gets one trailing column, after the eight", () => {
  const board = boardOf(view("unknown-lane"), { answer: "view" });
  assert.deepEqual(board.columns.map((column) => column.lanes[0]), [...LANES, "quarantine"]);
  assert.equal(board.columns.at(-1)?.unknown, true);
  assert.deepEqual(board.columns.at(-1)?.cards.map((card) => card.id), ["c-2"]);
});

test("CT-121-03 (Lisa App.tsx:598-609): builders are DOM-free — src/shared/ imports nothing from src/client/ and runs in Node", () => {
  const shared = join(packageRoot, "src", "shared");
  for (const file of readdirSync(shared, { recursive: true }) as string[]) {
    if (!file.endsWith(".ts")) continue;
    const text = readFileSync(join(shared, file), "utf8");
    assert.doesNotMatch(text, /from\s+["'](\.\.\/)*client\//, `${file} imports from src/client/`);
    assert.doesNotMatch(text, /\b(document|window)\s*[.[]/, `${file} touches the DOM`);
  }
  // The builders run in plain Node: every fixture view renders to a tree here, no DOM.
  const index = JSON.parse(readFileSync(join(views, "index.json"), "utf8")) as { valid: string[] };
  for (const name of index.valid) {
    const board = boardOf(view(name), { answer: "view" });
    assert.ok(board.columns.length >= 8, name);
    assert.ok(serialize(boardTree(board)).length > 0, name);
  }
});

test("CT-121-04 (Lisa App.tsx:245-282): data attributes and aria-label on badges — every card carries id, lane and ruleId; flag badges are labelled", () => {
  for (const name of ["one-feature-each-lane", "blocked-card", "unknown-lane", "two-features-grouped"]) {
    const tree = boardTree(view(name));
    const cards: Node[] = [];
    const badges: Node[] = [];
    walk(tree, (node) => {
      if ("data-card-id" in node.attrs) cards.push(node);
      if ("aria-label" in node.attrs && !("data-kanban" in node.attrs) && !("data-lane" in node.attrs)) badges.push(node);
    });
    const source = view(name);
    assert.deepEqual(
      cards.map((card) => [card.attrs["data-card-id"], card.attrs["data-lane"], card.attrs["data-rule-id"]]).sort(),
      source.cards.map((card) => [card.id, card.lane, card.ruleId]).sort(),
      `${name}: every view card is a node with its id, own lane and ruleId`,
    );
    for (const badge of badges) {
      assert.ok(badge.attrs["aria-label"].length > 0, `${name}: badge without an aria-label`);
      assert.ok(typeof badge.text === "string" && badge.text.length > 0, `${name}: badge without text`);
    }
  }
  const tree = boardTree(view("blocked-card"));
  const badges: Node[] = [];
  walk(tree, (node) => {
    if ("data-flag" in node.attrs) badges.push(node);
  });
  assert.deepEqual(badges.map((badge) => badge.attrs["aria-label"]), ["yielded"], "blocked-card: the yielded flag is a labelled badge");
});

test("CT-121-01 (Lisa App.tsx:115-145): equal views give equal trees — the render is a pure function of the view", () => {
  for (const name of ["one-feature-each-lane", "dead", "stale-heartbeat", "big-2000"]) {
    const first = boardTree(view(name));
    const second = boardTree(view(name));
    assert.equal(serialize(first), serialize(second), name);
  }
  const options = { merge: [["approved", "failed"]] as string[][] , hide: ["paused"] };
  const board: BoardModel = boardOf(view("one-feature-each-lane"), options);
  assert.equal(serialize(boardTree(board)), serialize(boardTree(boardOf(view("one-feature-each-lane"), options))));
});
