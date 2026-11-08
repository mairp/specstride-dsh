/** T009 — the fixture views against the pinned strict isRunView (gate G-A). */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isRunView, tryReadRunView } from "@specstride/contracts/records/run-view";

const views = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "views");
const read = (name: string): unknown => JSON.parse(readFileSync(join(views, `${name}.json`), "utf8"));
type Index = {
  valid: string[];
  unknownMember: Record<string, { path: string | null; reason?: string; refusedByAcceptView: boolean }>;
};
const index = JSON.parse(readFileSync(join(views, "index.json"), "utf8")) as Index;

test("index.json names every fixture file and no other", () => {
  const files = readdirSync(views).filter((name) => name.endsWith(".json") && name !== "index.json").map((n) => n.slice(0, -5)).sort();
  assert.deepEqual([...index.valid, ...Object.keys(index.unknownMember)].sort(), files);
});

test("every fixture outside the unknown-member set passes the strict isRunView", () => {
  for (const name of index.valid) assert.equal(isRunView(read(name)), true, name);
});

test("each unknown-member fixture fails at exactly the one field index.json names", () => {
  for (const [name, row] of Object.entries(index.unknownMember)) {
    const value = read(name);
    assert.equal(isRunView(value), false, name);
    const result = tryReadRunView(value);
    assert.equal(result.ok, false);
    if (result.ok) continue;
    const error = result.error as unknown as { reason: string; errors: { path: string }[] };
    if (row.path === null) {
      assert.equal(error.reason, row.reason, name);
    } else {
      assert.deepEqual(error.errors.map((e) => e.path), [row.path], name);
    }
  }
});

test("the shapes the tests rely on", () => {
  const each = read("one-feature-each-lane") as { cards: { lane: string; ruleId: string }[] };
  assert.deepEqual(each.cards.map((c) => c.ruleId), ["L-01", "L-02", "L-03", "L-04", "L-05", "L-06", "L-07", "L-08"]);
  assert.equal((read("attention-all-kinds") as { attentionOmitted: number }).attentionOmitted, 3);
  assert.equal((read("big-2000") as { cards: unknown[] }).cards.length, 2000);
  assert.equal(
    (read("stale-major") as { conditions: { stale: { reason: string } } }).conditions.stale.reason,
    "event-major-out-of-range",
  );
  assert.equal((read("empty-run") as { state: string; cards: unknown[] }).state, "none");
  const markup = JSON.stringify(read("markup-text"));
  assert.ok(markup.includes("<script>") && markup.includes("onerror") && markup.includes("\\u0007"));
});
