/**
 * T031 — the paid lane and the release gate (F120-FR-024, F120-FR-025).
 *
 * The `eval` subcommand is the person-started paid lane: without a person's
 * mode it starts nothing; a run whose configuration names no model is
 * refused BEFORE ANY CALL (`RunRefusedError`). The release gate is the kit
 * `releaseCheckOf` over the required rules supplied here — task, 0.8, 3
 * runs, requirementId F120-FR-024, the two paid task names — no kit
 * default; it reads records only, through the kit
 * `isPaidRunRecord`/`appendRunRecord`/`readRunLog`, with model ids from the
 * run's configuration (`modelIdsFromConfiguration`, never a suite file) and
 * `skillTextsHashOf` matching that release's skill texts.
 *
 * Nothing here calls a model: the paid run itself is exercised only at its
 * refusal boundary.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RunRefusedError,
  appendRunRecord,
  isPaidRunRecord,
  modelIdsFromConfiguration,
  readRunLog,
  releaseCheckCallsAModel,
  skillTextsHashOf,
  type PaidRunRecord,
} from "@specstride/host-kit/evals";
import {
  DSH_RELEASE_CHECK_RULES,
  PAID_TASK_NAMES,
  RELEASE_GATE_TASK,
  evalMain,
  refuseWithoutAModel,
  releaseGateOf,
  runLogPathOf,
  skillTextsHashOfRelease,
} from "../../src/evals/paid-lane.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** One well-formed record of this host's suite run over its own skill texts. */
function recordOf(overrides: Partial<PaidRunRecord> = {}): PaidRunRecord {
  return {
    date: "2026-11-06T00:00:00.000Z",
    task: RELEASE_GATE_TASK,
    modelIds: ["paid-model-from-configuration"],
    calls: 6,
    cost: "0.42",
    skillTextsHash: skillTextsHashOfRelease(),
    resultPerSkill: [
      { skill: "specstride-run", scores: [1, 1, 1], scored: true },
      { skill: "specstride-reverse", scores: [0.9, 1, 1], scored: true },
    ],
    runsNotScored: [],
    ...overrides,
  };
}

test("the release rules are this host's own numbers — no kit default", () => {
  assert.deepEqual([...DSH_RELEASE_CHECK_RULES.paidTaskNames], ["trigger-suite-dsh", "live-probe-dsh"]);
  assert.equal(DSH_RELEASE_CHECK_RULES.task, RELEASE_GATE_TASK);
  assert.equal(DSH_RELEASE_CHECK_RULES.threshold, 0.8);
  assert.equal(DSH_RELEASE_CHECK_RULES.requiredRuns, 3);
  assert.equal(DSH_RELEASE_CHECK_RULES.requirementId, "F120-FR-024");
  assert.equal(releaseCheckCallsAModel(), false);
  assert.equal(PAID_TASK_NAMES.length, 2);
});

test("the gate passes on a 0.8-over-3-runs log on THIS release's skill texts (hash-matched)", () => {
  const verdict = releaseGateOf([recordOf()]);
  assert.equal(verdict.passed, true, verdict.reason);
});

test("the gate fails on another release's skill texts (hash mismatch)", () => {
  const other = recordOf({ skillTextsHash: "0".repeat(64) });
  const verdict = releaseGateOf([other]);
  assert.equal(verdict.passed, false);
  assert.match(verdict.reason, /F120-FR-024/);
});

test("the gate fails a run under the threshold or with fewer than the required runs", () => {
  const low = recordOf({
    resultPerSkill: [
      { skill: "specstride-run", scores: [0.5, 1, 1], scored: true },
      { skill: "specstride-reverse", scores: [1, 1, 1], scored: true },
    ],
  });
  assert.equal(releaseGateOf([low]).passed, false);
  const short = recordOf({
    resultPerSkill: [
      { skill: "specstride-run", scores: [1], scored: true },
      { skill: "specstride-reverse", scores: [1, 1, 1], scored: true },
    ],
  });
  assert.equal(releaseGateOf([short]).passed, false);
});

test("the gate fails a run that used an ablation", () => {
  const ablated = recordOf({ ablation: true } as Partial<PaidRunRecord>);
  assert.equal(releaseGateOf([ablated]).passed, false);
});

test("an empty log fails the gate — a release is not made without the log", () => {
  assert.equal(releaseGateOf([]).passed, false);
});

test("records round-trip through the kit guard, writer and reader", () => {
  const dir = mkdtempSync(join(tmpdir(), "specstride-dsh-log-"));
  try {
    const logPath = join(dir, "run-log.jsonl");
    const record = recordOf();
    assert.equal(isPaidRunRecord(record, PAID_TASK_NAMES), true);
    const foreignTask = recordOf({ task: "trigger-suite-somewhere-else" });
    assert.equal(isPaidRunRecord(foreignTask, PAID_TASK_NAMES), false);
    appendRunRecord(logPath, record);
    appendRunRecord(logPath, foreignTask);
    const read = readRunLog(logPath, PAID_TASK_NAMES);
    assert.equal(read.length, 1, "the reader drops records of another host's paid tasks");
    assert.deepEqual(read[0], record);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("model ids come from the run's configuration, never from a suite file", () => {
  assert.deepEqual([...modelIdsFromConfiguration({ modelIds: ["a"], judgeModelIds: ["b"] })], ["a"]);
  assert.throws(() => modelIdsFromConfiguration({}), RunRefusedError);
  for (const relative of ["evals/suites/specstride-run.suite.json", "evals/suites/specstride-reverse.suite.json"]) {
    const parsed = JSON.parse(readFileSync(join(ROOT, relative), "utf8")) as Record<string, unknown>;
    assert.equal("modelIds" in parsed || "model" in parsed, false, relative);
  }
});

test("a configuration naming no model is refused BEFORE ANY CALL (RunRefusedError)", () => {
  assert.throws(() => refuseWithoutAModel({}), RunRefusedError);
  assert.throws(() => refuseWithoutAModel({ modelIds: [] }), RunRefusedError);
  assert.deepEqual([...refuseWithoutAModel({ modelIds: ["m1"] })], ["m1"]);
});

test("the eval subcommand starts nothing on its own and refuses without a model", () => {
  let captured: string | undefined;
  const originalError = console.error;
  console.error = (line: string) => {
    captured = line;
  };
  try {
    const code = evalMain([]);
    assert.equal(code, 3);
    assert.match(captured ?? "", /paid lane/);
    assert.match(captured ?? "", /F120-FR-024/);
  } finally {
    console.error = originalError;
  }
  // `suite-run` with no model refuses before any call — nothing is started.
  assert.throws(() => evalMain(["suite-run"]), RunRefusedError);
});

test("the skill-texts hash is taken over the release's own rendered skills in row-144 order", () => {
  const texts = ["specstride-run", "specstride-reverse", "specstride-doctor"].map((spelling) =>
    readFileSync(join(ROOT, "skills", spelling, "SKILL.md"), "utf8"),
  );
  assert.equal(skillTextsHashOfRelease(), skillTextsHashOf(texts));
  const swapped = skillTextsHashOf([texts[1]!, texts[0]!, texts[2]!]);
  assert.notEqual(skillTextsHashOfRelease(), swapped);
});

test("the run log lives under evals/ by default and honours an override", () => {
  assert.equal(runLogPathOf(), join(ROOT, "evals", "run-log.jsonl"));
  const dir = mkdtempSync(join(tmpdir(), "specstride-dsh-log-"));
  try {
    const override = join(dir, "log.jsonl");
    writeFileSync(override, "", "utf8");
    assert.equal(runLogPathOf(override), override);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
