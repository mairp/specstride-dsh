/**
 * T006 — the dsh frontmatter stage (F120-FR-002, F120-FR-003).
 * Fixture SKILL.md strings: a misspelled boolean fails; a 501-character
 * description fails; an unknown field fails; the three valid renders pass.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  insertDshFrontmatter,
  dshFrontmatterViolations,
  assertDshFrontmatter,
  isKebabCase,
  dshInvocationFieldsOf,
} from "../../src/frontmatter.ts";

const FIXTURES = {
  run: "---\nname: specstride-run\ndescription: Launch and supervise a Specstride run from dsh.\n---\n\n# Run\n\nBody.\n",
  reverse:
    "---\nname: specstride-reverse\ndescription: Reverse a Specstride run from dsh.\n---\n\n# Reverse\n\nBody.\n",
  doctor:
    "---\nname: specstride-doctor\ndescription: Diagnose the Specstride install on dsh.\n---\n\n# Doctor\n\nBody.\n",
};

test("insertion adds user-invocable true on all three (F120-FR-002)", () => {
  for (const [logicalId, fixture] of Object.entries(FIXTURES)) {
    const composed = insertDshFrontmatter(logicalId, fixture);
    assert.match(composed, /^---\nname: [^\n]+\ndescription: [^\n]+\nuser-invocable: true\ndisable-model-invocation: (true|false)\n---/);
  }
});

test("disable-model-invocation is false on run/reverse, true on doctor", () => {
  assert.match(insertDshFrontmatter("specstride-run", FIXTURES.run), /disable-model-invocation: false/);
  assert.match(insertDshFrontmatter("specstride-reverse", FIXTURES.reverse), /disable-model-invocation: false/);
  assert.match(insertDshFrontmatter("doctor", FIXTURES.doctor), /disable-model-invocation: true/);
  assert.deepEqual(dshInvocationFieldsOf("doctor"), [
    ["user-invocable", "true"],
    ["disable-model-invocation", "true"],
  ]);
});

test("the three valid renders pass validation", () => {
  for (const [logicalId, fixture] of Object.entries(FIXTURES)) {
    const composed = insertDshFrontmatter(logicalId, fixture);
    assert.deepEqual(dshFrontmatterViolations(composed), []);
    assertDshFrontmatter(composed, `${logicalId}/SKILL.md`);
  }
});

test("a misspelled boolean fails (dsh would drop the skill silently)", () => {
  const bad =
    "---\nname: specstride-run\ndescription: d\nuser-invocable: true\ndisable-model-invocation: False\n---\nbody\n";
  const violations = dshFrontmatterViolations(bad);
  assert.ok(violations.some((v) => v.field === "disable-model-invocation"));
  assert.throws(() => assertDshFrontmatter(bad, "specstride-run/SKILL.md"), /disable-model-invocation/);
  assert.throws(
    () => assertDshFrontmatter(bad, "specstride-run/SKILL.md"),
    /build fails because dsh drops a malformed skill silently/,
  );
});

test("a 501-character description fails", () => {
  const long = "x".repeat(501);
  const bad = `---\nname: specstride-run\ndescription: ${long}\n---\nbody\n`;
  const violations = dshFrontmatterViolations(bad);
  assert.ok(violations.some((v) => v.field === "description" && /501 characters/.test(v.problem)));
  assert.throws(() => assertDshFrontmatter(bad, "specstride-run/SKILL.md"), /501 characters/);
  assert.deepEqual(dshFrontmatterViolations(`---\nname: n\ndescription: ${"x".repeat(500)}\n---\n`), []);
});

test("an unknown field fails", () => {
  const bad = "---\nname: specstride-run\ndescription: d\nhooks: []\n---\nbody\n";
  const violations = dshFrontmatterViolations(bad);
  assert.ok(violations.some((v) => v.field === "hooks" && /does not know/.test(v.problem)));
  assert.throws(() => assertDshFrontmatter(bad, "specstride-run/SKILL.md"), /hooks/);
});

test("a non-kebab-case name fails", () => {
  const bad = "---\nname: Specstride Run\ndescription: d\n---\nbody\n";
  assert.ok(dshFrontmatterViolations(bad).some((v) => v.field === "name"));
  assert.equal(isKebabCase("specstride-run"), true);
  assert.equal(isKebabCase("specstride-doctor"), true);
  assert.equal(isKebabCase("Specstride-Run"), false);
});
