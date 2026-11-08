/**
 * T003 — the tracked runtime contract contracts/kanban-closed-sets.json (G-A).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LANES, ATTENTION_KINDS, BUDGET_LEVELS } from "@specstride/contracts/records/run-view";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const contract = JSON.parse(readFileSync(join(ROOT, "contracts", "kanban-closed-sets.json"), "utf8"));
const spec = JSON.parse(readFileSync(join(ROOT, "specs", "121-dsh-kanban", "contracts", "closed-sets.json"), "utf8"));

type Row = { id: string; members: Record<string, unknown>[]; unknown?: { glyph: string; label: string; grayscale: number } };
const row = (id: string): Row => {
  const r = contract.proposedByFeature.find((x: Row) => x.id === id);
  assert.ok(r, `row ${id} present`);
  return r;
};
const consumed = (set: string): string[] => {
  const r = contract.consumedFromEngine.find((x: { set: string }) => x.set === set);
  assert.ok(r, `consumed set ${set} present`);
  return r.members;
};

test("the file parses and carries the proposed rows of the spec contract", () => {
  assert.equal(contract.feature, "121-dsh-kanban");
  assert.deepEqual(contract.proposedByFeature, spec.proposedByFeature);
  assert.deepEqual(contract.consumedFromEngine, spec.consumedFromEngine);
  const ids = contract.proposedByFeature.map((r: Row) => r.id);
  for (const id of [
    "kanban-tab-identity", "kanban-lane-presentation", "kanban-attention-presentation",
    "kanban-budget-presentation", "kanban-cli-verbs", "kanban-route-answers",
  ]) assert.ok(ids.includes(id), id);
});

test("the tab identity is conversation.view / kanban / 20", () => {
  assert.deepEqual(row("kanban-tab-identity").members, [{ slot: "conversation.view", id: "kanban", order: 20 }]);
});

test("the consumed member lists equal the pinned contracts", () => {
  assert.deepEqual(consumed("lanes"), [...LANES]);
  assert.deepEqual(consumed("attention-kinds"), [...ATTENTION_KINDS]);
  assert.deepEqual(consumed("budget-levels"), [...BUDGET_LEVELS]);
});

const sets: [string, string, string, readonly string[]][] = [
  ["kanban-lane-presentation", "lane", "lanes", LANES],
  ["kanban-attention-presentation", "kind", "attention-kinds", ATTENTION_KINDS],
  ["kanban-budget-presentation", "level", "budget-levels", BUDGET_LEVELS],
];
for (const [id, key, set, pinned] of sets) {
  test(`${id} is total over ${set}, pairwise distinct, grayscale >= 24 apart`, () => {
    const r = row(id);
    assert.deepEqual(r.members.map((m) => m[key]), [...pinned], "total, in the pinned order");
    assert.ok(r.unknown, "unknown entry present");
    const all = [...r.members, r.unknown] as { glyph: string; label: string; grayscale: number }[];
    for (const channel of ["glyph", "label", "grayscale"] as const) {
      assert.equal(new Set(all.map((m) => m[channel])).size, all.length, `${channel} pairwise distinct`);
    }
    assert.equal(r.unknown.glyph, "?");
    const g = all.map((m) => m.grayscale).sort((a, b) => a - b);
    for (const v of g) assert.ok(Number.isInteger(v) && v >= 0 && v <= 255);
    for (let i = 1; i < g.length; i++) assert.ok(g[i]! - g[i - 1]! >= 24, `${g[i - 1]} and ${g[i]} are 24 apart`);
  });
}

test("the CLI verbs are exactly status --json and wait --until-change", () => {
  const argvs = row("kanban-cli-verbs").members.map((m) => (m.argv as string[]).slice(0, 2).join(" "));
  assert.deepEqual(argvs, ["status --json", "wait --until-change"]);
});

test("the route answers are the nine of the spec", () => {
  assert.deepEqual(row("kanban-route-answers").members, [
    "view", "unchanged", "no-run", "refused-schema", "unavailable",
    "run-changed", "forbidden", "method-not-allowed", "bad-request",
  ]);
});

test("host.kanban-plugin is added to 120's host checks as the seventh", () => {
  assert.deepEqual(contract.addedToFeature120.map((m: { member: string }) => m.member), ["host.kanban-plugin"]);
});
