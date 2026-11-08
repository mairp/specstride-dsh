/** T045 — PT-121-021 (F121-FR-021): the orbit view of the board is deterministic and well-formed. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { acceptView, type ReadView } from "../../src/shared/view-read.ts";
import { orbitOf } from "../../src/shared/orbit.ts";
import { LANES } from "../../src/shared/generated/contract-values.ts";

const views = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "views");
const read = (name: string) => JSON.parse(readFileSync(join(views, `${name}.json`), "utf8")) as Record<string, unknown>;
const index = JSON.parse(readFileSync(join(views, "index.json"), "utf8")) as {
  valid: string[];
  unknownMember: Record<string, { refusedByAcceptView: boolean }>;
};

/** Every fixture acceptance lets through is orbitable, including the unknown-lane render. */
const orbitable = [...index.valid, ...Object.keys(index.unknownMember)]
  .filter((name) => acceptView(read(name)).ok)
  .sort();

const viewOf = (name: string): ReadView => (acceptView(read(name)) as { ok: true; view: ReadView }).view;

type Ring = { lane: string; radius: number; cards: readonly { id: string; lane: string; x: number; y: number }[] };
type Orbit = { rings: readonly Ring[]; lines: readonly string[] };

const orbit = (name: string): Orbit => orbitOf(viewOf(name)) as unknown as Orbit;
const lanesOf = (view: ReadView): string[] => view.cards.map((card) => card.lane);
const known = (lane: string) => (LANES as readonly string[]).includes(lane);

/** The board order of the orbit: the eight lanes in LANES order, then the unknown lanes in first-appearance order. */
function boardOrder(view: ReadView): string[] {
  const seen: string[] = [];
  for (const lane of lanesOf(view)) if (!seen.includes(lane)) seen.push(lane);
  return [...LANES].filter((lane) => seen.includes(lane)).concat(seen.filter((lane) => !known(lane)));
}

test("two orbitOf calls of every fixture serialize equal", () => {
  for (const name of orbitable) {
    const first = JSON.stringify(orbitOf(viewOf(name)));
    const second = JSON.stringify(orbitOf(viewOf(name)));
    assert.equal(first, second, `${name}: two orbits differ`);
  }
});

test("rings follow the board's column order; ring i of the eight has radius 120 + i × 90", () => {
  for (const name of orbitable) {
    const view = viewOf(name);
    const { rings } = orbit(name);
    const order = boardOrder(view);
    const lanes = rings.map((ring) => ring.lane);
    const expected = order.filter((lane) => lanes.includes(lane));
    assert.deepEqual(lanes, expected, `${name}: rings are not in board order`);
    // every ring whose lane the engine names appears in LANES order, before any rim ring
    const knownLanes = lanes.filter(known);
    assert.deepEqual(knownLanes, [...LANES].filter((lane) => knownLanes.includes(lane)), `${name}: the eight are out of order`);
    assert.deepEqual(lanes.slice(0, knownLanes.length), knownLanes, `${name}: a rim ring precedes a lane ring`);
    // every unknown lane of the board is a rim ring after the eight
    const unknownLanes = order.filter((lane) => !known(lane));
    for (const lane of unknownLanes) assert.ok(lanes.includes(lane), `${name}: rim ring missing for lane ${lane}`);
    for (const ring of rings) {
      if (!known(ring.lane)) continue;
      const i = (LANES as readonly string[]).indexOf(ring.lane);
      assert.equal(ring.radius, 120 + i * 90, `${name}: ring ${ring.lane} has radius ${ring.radius}`);
    }
  }
});

test("every coordinate has at most 3 decimals and no coordinate serializes as -0", () => {
  for (const name of orbitable) {
    const text = JSON.stringify(orbitOf(viewOf(name)));
    assert.ok(!text.includes("-0"), `${name}: a coordinate serializes as -0`);
    const { rings } = orbit(name);
    for (const ring of rings) {
      for (const card of ring.cards) {
        for (const value of [card.x, card.y]) {
          assert.equal(typeof value, "number", `${name}: coordinate is not a number`);
          const decimals = (String(value).split(".")[1] ?? "").length;
          assert.ok(decimals <= 3, `${name}: coordinate ${value} has ${decimals} decimals`);
        }
      }
    }
  }
});

test("the readout names every ring with its count and every card with its lane, in board order", () => {
  for (const name of orbitable) {
    const view = viewOf(name);
    const { rings, lines } = orbit(name);
    const cardIds = new Set(view.cards.map((card) => card.id));
    // one line per ring: it names the lane and the number of cards the ring holds
    const ringLines = rings.map((ring) => {
      const line = lines.find((line) => line.includes(ring.lane) && line.includes(String(ring.cards.length)));
      assert.ok(line !== undefined, `${name}: no readout line for ring ${ring.lane} (${ring.cards.length})`);
      return line;
    });
    // one line per card: it names the card and its lane; every card of the board is named
    const cardLines = lines.filter((line) => [...cardIds].some((id) => line.includes(id)));
    assert.equal(cardLines.length, view.cards.length, `${name}: ${cardLines.length} card lines for ${view.cards.length} cards`);
    for (const card of view.cards) {
      const line = cardLines.find((line) => line.includes(card.id));
      assert.ok(line !== undefined, `${name}: no readout line for card ${card.id}`);
      assert.ok(line.includes(card.lane), `${name}: the line for ${card.id} does not name lane ${card.lane}`);
    }
    // board order: the per-card lines list the lanes in board order (rings first, cards after)
    const inBoardOrder = [...ringLines, ...cardLines];
    const ordered = lines.filter((line) => inBoardOrder.includes(line));
    assert.deepEqual(ordered, inBoardOrder, `${name}: the readout is not in board order`);
  }
});

test("a board with no cards has a readout of ring lines only", () => {
  const { rings, lines } = orbit("empty-run");
  for (const line of lines) {
    assert.ok(
      rings.some((ring) => line.includes(ring.lane)),
      "empty-run: the readout carries a line that names no ring",
    );
  }
});
