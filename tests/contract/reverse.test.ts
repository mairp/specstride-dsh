/**
 * T016 — the contract test for the reverse skill (PT-120-004, PT-120-006;
 * F120-FR-004, F120-FR-006; US2).
 *
 * The rendered `specstride-reverse` body carries the kit's `REVERSE_STEPS`
 * in order and the same prohibitions; its modes come from `REVERSE_MODES`
 * with the `DRY_RUN_FLAG` withholding consent; it ends at the plan and the
 * inventory and never launches or writes (`MODIFIES_THE_SOURCES` false);
 * the 7,000-token budget holds over the COMPOSED body.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DRY_RUN_FLAG,
  MODIFIES_THE_SOURCES,
  PROHIBITION_TEXTS,
  REVERSE_MODES,
  REVERSE_STEP_IDS,
  REVERSE_STEPS,
  SOURCES_ARE_READ_ONLY_LINE,
  stepIds,
  stepLines,
} from "@specstride/host-kit";
import { builtRunBody, ROOT } from "./run-body.ts";
import { dshBodyBudgets, dshReverseBody } from "../../src/skills.ts";

/** The composed reverse body as the build shipped it. */
function builtReverseBody(): string {
  return readFileSync(join(ROOT, "skills", "specstride-reverse", "SKILL.md"), "utf8");
}

test("the rendered body carries the kit's REVERSE_STEPS in order", () => {
  const body = builtReverseBody();
  assert.deepEqual(stepIds(REVERSE_STEPS), REVERSE_STEP_IDS);
  // Each numbered step line appears in the composed body, in the kit's order.
  let at = -1;
  for (const line of stepLines(REVERSE_STEPS)) {
    const i = body.indexOf(line);
    assert.ok(i >= 0, `the body carries the step line: ${line}`);
    assert.ok(i > at, `the step lines stay in the kit's order at: ${line}`);
    at = i;
  }
});

test("the same prohibitions as every other skill of this host", () => {
  const body = builtReverseBody();
  const runBody = builtRunBody();
  assert.ok(PROHIBITION_TEXTS.length > 0);
  for (const p of PROHIBITION_TEXTS) {
    assert.ok(body.includes(p.text), `the reverse body carries: ${p.id}`);
    assert.ok(runBody.includes(p.text), `the run body carries the same text: ${p.id}`);
  }
});

test("modes via REVERSE_MODES, with the DRY_RUN_FLAG withholding consent", () => {
  const body = builtReverseBody();
  assert.deepEqual([...REVERSE_MODES], ["run", "dry-run"]);
  assert.ok(body.includes(DRY_RUN_FLAG), `the body names ${DRY_RUN_FLAG}`);
  // Invoking the skill IS the consent; the dry run withholds it.
  assert.match(body, /consent/i);
  assert.match(body, /dry.run/i);
});

test("it ends at the plan and the inventory and never launches or writes", () => {
  const body = builtReverseBody();
  assert.equal(MODIFIES_THE_SOURCES, false);
  // The read-only line is in the body, in full.
  assert.ok(body.includes(SOURCES_ARE_READ_ONLY_LINE));
  // No launch STEP: `launch` is the run skill's step, never the reverse
  // skill's — the reverse run goes through the `reverse` command. (The dsh
  // runtime notes section names the launch step only as a rule of the run
  // skill it is shared with; it is not one of the reverse skill's steps.)
  const steps = [...body.matchAll(/^\d+\. (.+)$/gm)].map((m) => m[1]);
  assert.ok(!steps.some((s) => /^launch|launch the run/i.test(s)), "no launch step");
  assert.ok(!/(^|\s)`?launch`?\s+--repo/i.test(body), "no launch command invocation");
  // Nothing of the run pipeline's write steps is in the body.
  assert.ok(!/contract (validate|promote|render)/.test(body), "no write step of the run pipeline");
  // The steps that precede supervision are plan and inventory.
  const numbered = [...body.matchAll(/^\d+\. (.+)$/gm)].map((m) => m[1]);
  const planAt = numbered.findIndex((l) => l.startsWith("Plan the reverse run"));
  const inventoryAt = numbered.findIndex((l) => l.startsWith("Take the source inventory"));
  assert.ok(planAt >= 0 && inventoryAt === planAt + 1, "plan then inventory, adjacent");
  // The body never claims to modify a source.
  assert.ok(!/edit (a|any|the) source|write (a|any|the) source file/i.test(body));
});

test("the 7,000-token budget holds over the composed body", () => {
  const composed = dshReverseBody();
  const shipped = builtReverseBody();
  // The shipped SKILL.md is the frontmatter over the composed body.
  assert.ok(shipped.endsWith(composed), "the shipped file carries the composed body");
  dshBodyBudgets.assertBodyFitsItsLimit("specstride-reverse", composed);
});
