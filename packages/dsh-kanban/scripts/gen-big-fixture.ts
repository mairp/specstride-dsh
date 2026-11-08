/**
 * T009 — generates tests/fixtures/views/big-2000.json: 2,000 cards on the
 * `verifying` lane (F121-FR-020 windowing). Deterministic: no clock, no
 * randomness. The base is `one-feature-each-lane.json`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const views = join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures", "views");
const COUNT = 2000;

type Card = { id: string; feature: string; phase: number; lane: string; ruleId: string; flags: Record<string, boolean> };
const base = JSON.parse(readFileSync(join(views, "one-feature-each-lane.json"), "utf8")) as Record<string, unknown> & {
  lanes: { lane: string; cards: string[] }[];
};

const cards: Card[] = [];
for (let i = 1; i <= COUNT; i += 1) {
  cards.push({
    id: `big-${i}`,
    feature: `feature-${(i % 20) + 1}`,
    phase: i,
    lane: "verifying",
    ruleId: "L-03",
    flags: { dead: false, stale: false, yielded: false },
  });
}
const view = {
  ...base,
  cards,
  phases: cards.map((card) => ({ number: card.phase, title: `Phase ${card.phase}`, evidence: false, approved: false, feedback: false })),
  lanes: base.lanes.map((lane) => ({ lane: lane.lane, cards: lane.lane === "verifying" ? cards.map((card) => card.id) : [] })),
};
writeFileSync(join(views, "big-2000.json"), `${JSON.stringify(view, null, 2)}\n`, "utf8");
console.log(`gen-big-fixture: wrote big-2000.json (${COUNT} cards)`);
