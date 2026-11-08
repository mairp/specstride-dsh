/** T008 — one negative fixture per rule (each fails with its rule named); the real tree passes. */
import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RULES, formatFinding, scanTree } from "../../scripts/scan.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => join(here, "..", "fixtures", "scan", name);
const packageRoot = join(here, "..", "..");

const negatives: [fixture: string, rule: string, mention: RegExp][] = [
  ["no-lane-assignment", "no-lane-assignment", /card\.lane = "reviewing"/],
  ["no-lane-assignment-columnof", "no-lane-assignment", /columnOf reads card\.ruleId/],
  ["css-colour", "css-colour", /#ff0000/],
  ["css-selector", "css-selector", /:root|\.card/],
  ["markup-sink", "markup-sink", /innerHTML/],
  ["nondeterminism", "nondeterminism", /Date/],
  ["install-script", "install-script", /postinstall/],
];

for (const [name, rule, mention] of negatives) {
  test(`fixture ${name} fails rule ${rule}`, () => {
    const findings = scanTree(fixture(name));
    const named = findings.filter((finding) => finding.rule === rule);
    assert.ok(named.length > 0, `expected rule ${rule}; got ${findings.map(formatFinding).join("; ")}`);
    assert.ok(named.some((finding) => mention.test(finding.detail)), named.map(formatFinding).join("; "));
    assert.ok(RULES.includes(rule as (typeof RULES)[number]));
  });
}

test("the css-selector fixture names both the :root block and the unprefixed class", () => {
  const details = scanTree(fixture("css-selector")).map((finding) => finding.detail).join("\n");
  assert.match(details, /":root"/);
  assert.match(details, /"\.card"/);
});

test("the clean fixture passes: comments, var(--dsw-…), currentColor, keyframes, prefixed selectors", () => {
  assert.deepEqual(scanTree(fixture("clean")).map(formatFinding), []);
});

test("the real tree passes", () => {
  assert.deepEqual(scanTree(packageRoot).map(formatFinding), []);
});
