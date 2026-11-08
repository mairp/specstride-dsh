/** T026 — PT-121-010 (F121-FR-010): the engine conditions surface as text banners; lanes are untouched. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { acceptView } from "../../src/shared/view-read.ts";
import { boardOf, type BannerModel, type BoardModel } from "../../src/shared/board-model.ts";
import { boardTree } from "../../src/shared/board-tree.ts";
import { columnOf } from "../../src/shared/board-model.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const views = join(packageRoot, "tests", "fixtures", "views");
const read = (name: string) => JSON.parse(readFileSync(join(views, `${name}.json`), "utf8")) as Record<string, unknown>;

const viewOf = (name: string) => (acceptView(read(name)) as { ok: true; view: unknown }).view;

/** The fixture's banner of exactly one condition, asserting there is exactly one. */
function oneBanner(board: BoardModel, condition: BannerModel["condition"]): BannerModel {
  const matching = board.banners.filter((banner) => banner.condition === condition);
  assert.equal(matching.length, 1, `${condition}: expected exactly one banner, got ${matching.length}`);
  return matching[0] as BannerModel;
}

test("dead gives exactly one banner naming the condition", () => {
  const banner = oneBanner(boardOf(viewOf("dead"), { answer: "view" }), "dead");
  assert.equal(banner.text, "Run is dead");
  assert.ok(banner.text.toLowerCase().includes("dead"));
});

test("stale-heartbeat gives exactly one banner naming the condition and the reason", () => {
  const banner = oneBanner(boardOf(viewOf("stale-heartbeat"), { answer: "view" }), "stale");
  assert.equal(banner.text, "View is stale: heartbeat-and-events-old");
  assert.ok(banner.text.includes("heartbeat-and-events-old"));
});

test("stale-major gives exactly one banner naming the condition and the reason", () => {
  const banner = oneBanner(boardOf(viewOf("stale-major"), { answer: "view" }), "stale");
  assert.equal(banner.text, "View is stale: event-major-out-of-range");
  assert.ok(banner.text.includes("event-major-out-of-range"));
});

test("launch-abandoned gives exactly one banner naming the condition", () => {
  const banner = oneBanner(boardOf(viewOf("launch-abandoned"), { answer: "view" }), "launch-abandoned");
  assert.equal(banner.text, "Launch abandoned");
  assert.ok(banner.text.toLowerCase().includes("abandoned"));
});

test("each condition fixture carries its own engine condition, no other engine banner", () => {
  const expected: Record<string, BannerModel["condition"]> = {
    dead: "dead",
    "stale-heartbeat": "stale",
    "stale-major": "stale",
    "launch-abandoned": "launch-abandoned",
  };
  for (const [name, condition] of Object.entries(expected)) {
    const board = boardOf(viewOf(name), { answer: "view" });
    const engineBanners = board.banners.filter((banner) => banner.condition !== "client-stale");
    assert.deepEqual(
      engineBanners.map((banner) => banner.condition),
      [condition],
      `${name}: expected only a ${condition} banner`,
    );
  }
});

test("every card of every condition fixture keeps its lane", () => {
  for (const name of ["dead", "stale-heartbeat", "stale-major", "launch-abandoned"]) {
    const view = viewOf(name);
    const board = boardOf(view, { answer: "view" });
    const placed: string[] = [];
    for (const column of board.columns) {
      for (const card of column.cards) {
        assert.equal(card.lane, column.lanes[0], `${name}: card ${card.id} lane ${card.lane} in column ${column.lanes.join(",")}`);
        assert.equal(card.node.attrs["data-lane"], card.lane, `${name}: card ${card.id} node lost its lane`);
        assert.equal(columnOf(card, board.columns), column, `${name}: card ${card.id} resolves to a different column`);
        placed.push(card.id);
      }
    }
    const ids = view.cards.map((card: { id: string }) => card.id).sort();
    assert.deepEqual([...placed].sort(), ids, `${name}: the columns do not hold exactly the view's cards`);
  }
});

test("the client's own stale banner is separate from the engine's stale banner", () => {
  const view = viewOf("stale-heartbeat");
  const board = boardOf(view, { answer: "view", clientStaleSince: "10:00:01" });
  const engine = board.banners.filter((banner) => banner.condition === "stale");
  const client = board.banners.filter((banner) => banner.condition === "client-stale");
  assert.equal(engine.length, 1, "the engine stale banner is missing");
  assert.equal(client.length, 1, "the client stale banner is missing");
  assert.equal((engine[0] as BannerModel).text, "View is stale: heartbeat-and-events-old");
  assert.equal((client[0] as BannerModel).text, "Not updated since 10:00:01");
  assert.notEqual((engine[0] as BannerModel).condition, (client[0] as BannerModel).condition);
  assert.notEqual((engine[0] as BannerModel).text, (client[0] as BannerModel).text);
});

test("each banner renders as one status node carrying its condition", () => {
  for (const name of ["dead", "stale-heartbeat", "stale-major", "launch-abandoned"]) {
    const nodes = boardTree(viewOf(name)).children.filter((child) => child.attrs["role"] === "status");
    assert.ok(nodes.length >= 1, `${name}: no banner node rendered`);
    for (const banner of boardOf(viewOf(name), { answer: "view" }).banners) {
      const node = nodes.find((candidate) => candidate.attrs["data-condition"] === banner.condition);
      assert.ok(node !== undefined, `${name}: no node for ${banner.condition}`);
      assert.equal(node?.text, banner.text, `${name}: ${banner.condition} banner text drifted`);
    }
  }
});
