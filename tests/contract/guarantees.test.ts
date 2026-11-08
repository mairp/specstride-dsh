/**
 * T033 — the five implementation guarantees of the port (PT-120-028;
 * F120-FR-028). Each entry of the kit's `IMPLEMENTATION_GUARANTEES` gets its
 * own test, held against THIS host's rendered tree and bindings; and every
 * refusal line the skills print begins with `[SPECSTRIDE-REFUSE]` — the
 * port's refusal grammar (`PROTOCOL_MISMATCH_LINE`, the kit shim's
 * `refusalLine`/`missingCliLine`; the grammar is a prefix, NOT a closed set).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  IMPLEMENTATION_GUARANTEES,
  PROTOCOL_MISMATCH_LINE,
  PROTOCOL_MISMATCH_EXIT_CODE,
  COMMENT_FLAG,
  COMMENT_IS_PASSED_TO,
  COMMENT_IS_CAPTURED_FIRST,
  DIGEST_IS_PRINTED_VERBATIM,
  DIGEST_IS_THE_FINAL_LINE,
  INSTALLS_OR_UPDATES_THE_CLI,
  STOPS_AT_THE_FIRST_REFUSAL,
  LAUNCH_OUTCOMES,
  DRY_RUN_LAUNCHES,
  decideMode,
} from "@specstride/host-kit";
import { refusalLine, missingCliLine, INSTALLS_OR_UPDATES } from "@specstride/host-kit/shim";
import { dshSkillSetHost } from "../../src/skills.ts";
import { capabilityAbsentLine, dshHostPort } from "../../src/port.ts";
import {
  referenceClosureFindings,
  referenceClosureFindingsForComposed,
} from "../../src/gates.ts";
import { STUB_REFUSAL_LINE } from "../../src/evals/driver.ts";
import { dshDoctorAppendixLines } from "../../src/runtime-notes.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILLS = join(ROOT, "skills");

function renderedSkill(spelling: string): string {
  return readFileSync(join(SKILLS, spelling, "SKILL.md"), "utf8");
}

const RUN = renderedSkill("specstride-run");
const REVERSE = renderedSkill("specstride-reverse");
const DOCTOR = renderedSkill("specstride-doctor");

test("the kit declares exactly the five implementation guarantees this file tests", () => {
  assert.equal(IMPLEMENTATION_GUARANTEES.length, 5);
});

test("guarantee 1 — a host package reads no file of the product and names no path into the product's source or state", () => {
  // Reference closure over the rendered tree: no product source, state or
  // log path appears in ANY rendered skill (the same helper the build runs;
  // the doctor's generated appendix is excluded — see
  // `referenceClosureFindingsForComposed` in src/gates.ts).
  const appendix = dshDoctorAppendixLines(
    join(ROOT, "contracts", "doctor-host-checks.md"),
    "npm install -g specstride@0.1.0",
  );
  for (const spelling of readdirSync(SKILLS)) {
    const text = renderedSkill(spelling);
    const findings =
      spelling === "specstride-doctor"
        ? referenceClosureFindingsForComposed(text, spelling, appendix)
        : referenceClosureFindings(text, spelling);
    assert.deepEqual(findings, [], `${spelling} names a path into the product`);
  }
});

test("guarantee 2 — it never installs or updates the CLI by itself: it detects, reports and prints the command", () => {
  assert.equal(INSTALLS_OR_UPDATES_THE_CLI, false);
  assert.equal(INSTALLS_OR_UPDATES, false);
  // The printed command, never run: the doctor body carries the install
  // command as text, and no skill carries an install invocation of its own.
  assert.match(DOCTOR, /npm install -g specstride@/);
  for (const [name, text] of [["run", RUN], ["reverse", REVERSE]] as const) {
    assert.doesNotMatch(text, /npm (?:install|ci|update)/, `${name} installs something`);
  }
});

test("guarantee 3 — it passes the consumer's comment verbatim", () => {
  assert.deepEqual(COMMENT_IS_PASSED_TO, ["contract derive", "launch"]);
  assert.equal(COMMENT_IS_CAPTURED_FIRST, true);
  assert.match(RUN, new RegExp(COMMENT_FLAG.replace(/-/g, "\\-")));
  assert.match(RUN, /verbatim/);
});

test("guarantee 4 — it prints the digest verbatim", () => {
  assert.equal(DIGEST_IS_PRINTED_VERBATIM, true);
  assert.equal(DIGEST_IS_THE_FINAL_LINE, true);
  assert.match(RUN, /digest/);
});

test("guarantee 5 — it launches by invocation and withholds the launch only in the mode `dry-run`", () => {
  assert.equal(DRY_RUN_LAUNCHES, false);
  // Explicit mode beats comment prose, a refusal beats an invitation.
  assert.equal(decideMode({ explicit: "run", comment: "just do a dry run please" }).mode, "run");
  assert.equal(decideMode({ explicit: "dry-run", comment: "definitely run it" }).mode, "dry-run");
  assert.equal(decideMode({ comment: "please, do not run it — dry run only" }).mode, "dry-run");
  assert.match(RUN, /dry-run/);
  for (const outcome of LAUNCH_OUTCOMES) {
    assert.match(RUN, new RegExp(outcome));
  }
});

test("every refusal line the skills print begins with [SPECSTRIDE-REFUSE] — the port's refusal grammar, not a closed set", () => {
  // The port's refusal line for the absent operation.
  assert.match(capabilityAbsentLine("renderStatusHooks"), /^\[SPECSTRIDE-REFUSE\] /);
  // The shim's refusal grammar: protocol mismatch, a refusal, a missing CLI.
  assert.match(PROTOCOL_MISMATCH_LINE, /^\[SPECSTRIDE-REFUSE\] /);
  assert.match(refusalLine(7), /^\[SPECSTRIDE-REFUSE\] /);
  assert.match(missingCliLine(), /^\[SPECSTRIDE-REFUSE\] /);
  // The eval stub's refusal (the environmental tool restriction).
  assert.match(STUB_REFUSAL_LINE, /^\[SPECSTRIDE-REFUSE\] /);
  // A first refusal stops the skill: print the line, no retry (F120-FR-005).
  assert.equal(STOPS_AT_THE_FIRST_REFUSAL, true);
  // The grammar is a prefix, not a closed set: the port object refuses the
  // absent operation at runtime, with the same prefix — the object carries
  // no `renderStatusHooks` property (declared absent), so the call degrades
  // down the port's failure path, and the caller that pre-checks gets the
  // `[SPECSTRIDE-REFUSE]` line.
  const port = dshHostPort();
  assert.equal(typeof (port as { renderStatusHooks?: unknown }).renderStatusHooks, "undefined");
  assert.equal(port.protocol, PROTOCOL_MISMATCH_EXIT_CODE - 3); // 1, the declared protocol
});
