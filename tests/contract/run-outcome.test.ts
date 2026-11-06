/**
 * T013 — contract test for the outcome relay (PT-120-005; F120-FR-005,
 * F120-FR-014).
 *
 * The skill prints `started` / `attached` / `refused` exactly as the CLI
 * prints them (kit `LAUNCH_OUTCOMES`/`LAUNCH_OUTCOME_ACTIONS`), stops at the
 * first refusal printing the CLI line that names the fix without retrying,
 * prints no state it did not read from a CLI line
 * (`PRINTS_A_STATE_IT_DID_NOT_READ`), and no relayed line depends on
 * `--json` (the terse default lines are what the consumer sees).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  LAUNCH_OUTCOME_ACTIONS,
  LAUNCH_OUTCOMES,
  PRINTS_A_STATE_IT_DID_NOT_READ,
  PRINTS_THE_LINE_THAT_NAMES_THE_FIX,
  REFUSAL_EXIT_CODE,
  STOPS_AT_THE_FIRST_REFUSAL,
  supervisesAfter,
  retriesAfter,
} from "@specstride/host-kit";
import { builtRunBody } from "./run-body.ts";

const body = builtRunBody();

test("the three outcomes are the kit's, and the body relays each verbatim", () => {
  assert.deepEqual([...LAUNCH_OUTCOMES], ["started", "attached", "refused"]);
  assert.equal(PRINTS_A_STATE_IT_DID_NOT_READ, false);
  for (const outcome of LAUNCH_OUTCOMES) {
    const bullet = `- \`${outcome}\`: ${LAUNCH_OUTCOME_ACTIONS[outcome]}.`;
    assert.ok(body.includes(bullet), `outcome bullet missing: ${bullet}`);
  }
  // The outcome step says the line is printed as the CLI gave it.
  assert.match(body, /Print the outcome as the CLI gave it/);
});

test("the skill stops at the FIRST refusal, prints the line naming the fix, and never retries", () => {
  assert.equal(STOPS_AT_THE_FIRST_REFUSAL, true);
  assert.equal(PRINTS_THE_LINE_THAT_NAMES_THE_FIX, true);
  assert.equal(REFUSAL_EXIT_CODE, 4);
  for (const outcome of LAUNCH_OUTCOMES) {
    assert.equal(retriesAfter(outcome), false, `no retry after ${outcome}`);
  }
  assert.equal(supervisesAfter("started"), true);
  assert.equal(supervisesAfter("attached"), true);
  assert.equal(supervisesAfter("refused"), false);
  assert.match(
    body,
    /Stop at the FIRST refusal and print the line of the CLI that names the fix; go no further\./,
  );
  // The refusal action itself forbids an unasked retry.
  assert.match(LAUNCH_OUTCOME_ACTIONS.refused, /do not retry unless the consumer asks/);
});

test("the skill prints no state it did not read from a CLI line", () => {
  assert.equal(PRINTS_A_STATE_IT_DID_NOT_READ, false);
  assert.match(body, /Every fact you report is a line the CLI printed\./);
  assert.match(body, /Never print a state you did not read from a line\./);
});

test("no relayed line depends on --json: the terse default lines are what the consumer sees", () => {
  assert.ok(!body.includes("--json"), "the composed body never spells --json");
  assert.ok(!body.includes("--output json"), "no JSON output form is spelled");
});
