/** T014 — PT-121-009 (F121-FR-009): the board tree is deterministic and carries the attributes of contracts/presentation.md. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Node, serialize } from "../../src/shared/tree.ts";
import { acceptView } from "../../src/shared/view-read.ts";
import { boardTree } from "../../src/shared/board-tree.ts";
import { scanTree, type Finding } from "../../scripts/scan.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const views = join(packageRoot, "tests", "fixtures", "views");
const read = (name: string) => JSON.parse(readFileSync(join(views, `${name}.json`), "utf8")) as Record<string, unknown>;
const index = JSON.parse(readFileSync(join(views, "index.json"), "utf8")) as { valid: string[]; unknownMember: Record<string, unknown> };

/** Every fixture the acceptance rule of T011 lets through is renderable (T033 covers the unknown-member render). */
const renderable = [...index.valid, ...Object.keys(index.unknownMember)].filter((name) => acceptView(read(name)).ok).sort();

function walk(node: Node, visit: (node: Node) => void): void {
  visit(node);
  for (const child of node.children) walk(child, visit);
}

function flatten(node: Node): Node[] {
  const out: Node[] = [];
  walk(node, (n) => out.push(n));
  return out;
}

test("two renders of each fixture serialize equal", () => {
  for (const name of renderable) {
    const view = (acceptView(read(name)) as { ok: true; view: unknown }).view;
    const first = serialize(boardTree(view));
    const second = serialize(boardTree(view));
    assert.equal(first, second, `${name}: two renders differ`);
  }
});

test("the root carries data-kanban", () => {
  const view = (acceptView(read("one-feature-each-lane")) as { ok: true; view: unknown }).view;
  const root = boardTree(view);
  assert.equal(root.attrs["data-kanban"], "");
  for (const name of renderable) {
    const other = (acceptView(read(name)) as { ok: true; view: unknown }).view;
    assert.ok("data-kanban" in boardTree(other).attrs, `${name}: root has no data-kanban`);
  }
});

test("every column carries data-lane, every card data-card-id, data-lane and data-rule-id", () => {
  for (const name of renderable) {
    const view = (acceptView(read(name)) as { ok: true; view: unknown }).view;
    const nodes = flatten(boardTree(view));
    const cards = nodes.filter((n) => "data-card-id" in n.attrs);
    const columns = nodes.filter((n) => "data-lane" in n.attrs && !("data-card-id" in n.attrs));
    assert.ok(columns.length > 0 || view.lanes.length === 0, `${name}: no column found`);
    for (const card of cards) {
      for (const attribute of ["data-card-id", "data-lane", "data-rule-id"]) {
        assert.ok(card.attrs[attribute] !== undefined && card.attrs[attribute] !== "", `${name}: card attribute ${attribute} missing`);
      }
    }
    for (const column of columns) {
      assert.ok(column.attrs["data-lane"] !== "", `${name}: column without a data-lane value`);
    }
    const cardIds = new Set(cards.map((c) => c.attrs["data-card-id"]));
    for (const card of view.cards) assert.ok(cardIds.has(card.id), `${name}: card ${card.id} of the view is not in the tree`);
    for (const card of cards) {
      const source = view.cards.find((c) => c.id === card.attrs["data-card-id"]);
      assert.ok(source !== undefined, `${name}: card ${card.attrs["data-card-id"]} is not a view card`);
      assert.equal(card.attrs["data-lane"], source.lane, `${name}: card ${source.id} rendered on a foreign lane`);
      assert.equal(card.attrs["data-rule-id"], source.ruleId, `${name}: card ${source.id} lost its ruleId`);
    }
  }
});

test("every badge carries a non-empty aria-label", () => {
  for (const name of renderable) {
    const view = (acceptView(read(name)) as { ok: true; view: unknown }).view;
    const nodes = flatten(boardTree(view));
    // Badges are labelled nodes that are neither the root nor a column.
    const badges = nodes.filter((n) => "aria-label" in n.attrs && !("data-kanban" in n.attrs) && !("data-lane" in n.attrs));
    const labelled =
      badges.length +
      nodes.filter((n) => "aria-label" in n.attrs && "data-lane" in n.attrs).length;
    assert.ok(labelled > 0, `${name}: no labelled node at all`);
    for (const badge of badges) {
      assert.ok(typeof badge.attrs["aria-label"] === "string" && badge.attrs["aria-label"].length > 0, `${name}: badge with an empty aria-label`);
    }
  }
});

test("the scan rule (e) of T008 holds: no Math.random, Date or performance.now in src/shared/", () => {
  const findings: Finding[] = scanTree(packageRoot);
  const nondeterminism = findings.filter((f) => f.rule === "nondeterminism" && f.file.startsWith("src/shared/"));
  assert.deepEqual(
    nondeterminism.map((f) => `${f.file}:${f.line} ${f.detail}`),
    [],
    "src/shared/ reads a clock or randomness",
  );
});
