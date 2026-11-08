/** T011 — PT-121-004 (first half): the acceptance rule on every fixture of T009. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { acceptView } from "../../src/shared/view-read.ts";
import { SCHEMA_ID, MAJOR_RANGE } from "../../src/shared/generated/contract-values.ts";

const views = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "views");
const read = (name: string) => JSON.parse(readFileSync(join(views, `${name}.json`), "utf8")) as Record<string, unknown>;
const index = JSON.parse(readFileSync(join(views, "index.json"), "utf8")) as {
  valid: string[];
  unknownMember: Record<string, { refusedByAcceptView: boolean }>;
};

test("every valid fixture is accepted", () => {
  for (const name of index.valid) assert.equal(acceptView(read(name)).ok, true, name);
});

test("unknown lane, kind and level are accepted; schema-major-2 and no-schema are refused", () => {
  for (const [name, row] of Object.entries(index.unknownMember)) {
    assert.equal(acceptView(read(name)).ok, !row.refusedByAcceptView, name);
  }
  assert.equal(acceptView(read("unknown-lane")).ok, true);
  assert.equal(acceptView(read("unknown-kind")).ok, true);
  assert.equal(acceptView(read("unknown-level")).ok, true);
  assert.equal(acceptView(read("schema-major-2")).ok, false);
  assert.equal(acceptView(read("no-schema")).ok, false);
});

test("the refusal line names the schema found, the one supported and the doctor", () => {
  const major2 = acceptView(read("schema-major-2"));
  assert.ok(!major2.ok);
  assert.equal(major2.line, "Kanban cannot read this view (schema specstride.view/2, supported specstride.view/1) — run /specstride-doctor");
  const none = acceptView(read("no-schema"));
  assert.ok(!none.ok);
  assert.equal(none.line, "Kanban cannot read this view (schema none, supported specstride.view/1) — run /specstride-doctor");
  assert.equal(SCHEMA_ID, "specstride.view/1");
  assert.deepEqual(MAJOR_RANGE, { from: 1, to: 1 });
});

test("a malformed or non-object value is refused; the range is the generated one", () => {
  for (const value of [null, 3, "x", [], { schema: "specstride.view/0" }, { schema: "specstride.view/1.5" }, { schema: 1 }, { schema: "other/1" }]) {
    assert.equal(acceptView(value).ok, false, JSON.stringify(value));
  }
  const bad = read("one-feature-each-lane");
  bad.cards = "nope";
  assert.equal(acceptView(bad).ok, false);
  const wrongType = read("one-feature-each-lane");
  wrongType.attentionOmitted = "3";
  assert.equal(acceptView(wrongType).ok, false);
});

test("an accepted view is returned as given", () => {
  const value = read("two-features-grouped");
  const result = acceptView(value);
  assert.ok(result.ok);
  assert.equal(result.view as unknown, value);
});
