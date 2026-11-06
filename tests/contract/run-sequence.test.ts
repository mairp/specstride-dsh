/**
 * T011 — contract test for the run sequence (PT-120-004, PT-120-006;
 * F120-FR-004, F120-FR-006, F120-FR-013).
 *
 * The rendered `specstride-run` body carries the kit's `RUN_STEPS` order —
 * capture the comment; check the CLI; derive; judge; validate and promote;
 * render; launch; print the outcome; supervise; print the digest — with the
 * mode resolution of the kit's `decideMode` (F113-FR-005: an explicit mode
 * beats comment prose, a refusal beats an invitation); `dry-run` stops at
 * `DRY_RUN_LAST_STEP`, prints the plan and the validation verdict, launches
 * nothing; the launch step names a foreground shell call and forbids
 * `run_in_background: true` (the `src/runtime-notes.ts` lines present in
 * the composed body).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MODE,
  DRY_RUN_LAST_STEP,
  LAUNCH_OUTCOMES,
  MODES,
  RUN_STEP_IDS,
  RUN_STEPS,
  decideMode,
  stepLines,
  stepsOfMode,
} from "@specstride/host-kit";
import { dshRuntimeLinesFor } from "../../src/runtime-notes.ts";
import { builtRunBody } from "./run-body.ts";

const body = builtRunBody();

/** The ids of the ten steps, in the order of F120-FR-004. */
const EXPECTED_STEP_IDS = [
  "capture-the-comment",
  "cli-check",
  "derive",
  "judge",
  "validate",
  "render",
  "launch",
  "outcome-line",
  "supervise",
  "digest",
];

test("the kit's RUN_STEPS hold the ten steps of F120-FR-004, in order", () => {
  assert.equal(RUN_STEPS.length, 10);
  assert.deepEqual([...RUN_STEP_IDS], EXPECTED_STEP_IDS);
  assert.deepEqual(
    RUN_STEP_IDS.map((_, i) => RUN_STEPS[i].number),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
});

test("the composed body carries the RUN_STEPS order, verbatim and in order", () => {
  const lines = stepLines(RUN_STEPS);
  let cursor = 0;
  for (const line of lines) {
    const at = body.indexOf(line, cursor);
    assert.notEqual(at, -1, `step line missing or out of order: ${line}`);
    cursor = at + line.length;
  }
});

test("mode resolution follows kit decideMode (F113-FR-005)", () => {
  assert.deepEqual([...MODES], ["run", "dry-run"]);
  assert.equal(DEFAULT_MODE, "run");

  // The default: no explicit mode, no comment.
  assert.equal(decideMode({}).mode, "run");

  // An explicit mode beats prose in the comment — even inviting prose.
  const explicit = decideMode({
    explicit: "dry-run",
    comment: "run it, go ahead, for real",
  });
  assert.equal(explicit.mode, "dry-run");
  assert.equal(explicit.source, "the explicit mode of the consumer");
  assert.equal(explicit.changedByTheComment, false);

  // A refusal in the comment beats an invitation and gives dry-run.
  const refusal = decideMode({
    comment: "run it — actually, do not run yet, just show me",
  });
  assert.equal(refusal.mode, "dry-run");
  assert.equal(refusal.source, "a refusal in the comment");
  assert.equal(refusal.changedByTheComment, true);
  assert.ok(refusal.saysWhatChanged !== null);

  // An invitation with no explicit mode gives run, and says so.
  const invitation = decideMode({ comment: "go ahead and run it" });
  assert.equal(invitation.mode, "run");
  assert.equal(invitation.source, "an invitation in the comment");
  assert.equal(invitation.commentSelects[0], "mode");

  // The body states both rules the resolution rests on.
  assert.match(body, /An explicit mode from the consumer beats prose in the comment/);
  assert.match(body, /beats an invitation and gives `dry-run`/);
  assert.match(body, /Never infer a mode from the prose of the request outside the comment/);
});

test("dry-run stops at DRY_RUN_LAST_STEP, prints the plan and the verdict, launches nothing", () => {
  assert.equal(DRY_RUN_LAST_STEP, "validate");
  const drySteps = stepsOfMode("dry-run");
  assert.deepEqual([...drySteps.map((s) => s.id)], EXPECTED_STEP_IDS.slice(0, 5));
  assert.ok(!drySteps.some((s) => s.id === "launch"), "dry-run has no launch step");
  assert.match(body, /In `dry-run`: derive and validate, print the plan, and STOP\. Never launch\./);
  // The verdict step and the finding rule are what dry-run prints.
  assert.match(body, /Validate, and promote through validation/);
  assert.match(body, /a finding, NOT a failure of/);
});

test("the launch step is a foreground shell call and run_in_background: true is forbidden (F120-FR-013)", () => {
  const launchStep = RUN_STEPS.find((s) => s.id === "launch");
  assert.ok(launchStep);
  assert.match(launchStep.text, /Launch \(`launch`\)/);
  // The generated dsh runtime lines of src/runtime-notes.ts sit in the body.
  for (const row of dshRuntimeLinesFor("run")) {
    assert.ok(
      body.includes(row.line),
      `runtime line ${row.id} (${row.requirement}) missing from the composed body`,
    );
  }
  assert.match(body, /FOREGROUND shell call/);
  assert.match(body, /`run_in_background: true` is forbidden/);
  // The outcome step precedes supervision, and supervision precedes the digest.
  const ids = [...RUN_STEP_IDS];
  assert.ok(ids.indexOf("outcome-line") < ids.indexOf("supervise"));
  assert.ok(ids.indexOf("supervise") < ids.indexOf("digest"));
  assert.match(body, new RegExp(LAUNCH_OUTCOMES[2]));
});
