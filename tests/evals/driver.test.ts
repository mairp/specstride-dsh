/**
 * T030 — the eval driver glue (F120-FR-023, R9 — G-A for the kit types).
 *
 * The hermetic environment per case (DSH_HOME holds only the three rendered
 * skills, DSH_TELEMETRY_MODE=DISABLED, a temp working directory, a PATH
 * carrying a stub `specstride` whose launch refuses); the one
 * `dsh --profile headless "<prompt>"` task per case; the per-change build
 * composed with the kit `evalDriverRun` over the kit `stubSuiteRunner`
 * (model-free); the static check over this host's rules. Zero model calls.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evalDriverCallsAModel,
  staticCheckCallsAModel,
  SuiteRunnerInBuildError,
  containsModelId,
} from "@specstride/host-kit/evals";
import {
  DSH_STATIC_RULES,
  STUB_REFUSAL_LINE,
  buildJobsOf,
  dshHomeHoldsOnlyTheThreeSkills,
  dshStaticCheck,
  headlessTaskOf,
  hermeticEnvironment,
  loadGradersFile,
  loadSuiteFiles,
  runSuiteOnStub,
  staticFindings,
} from "../../src/evals/driver.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("the hermetic environment holds only the three skills, telemetry disabled, temp cwd", () => {
  const environment = hermeticEnvironment();
  try {
    assert.equal(dshHomeHoldsOnlyTheThreeSkills(environment.dshHome), true);
    assert.equal(environment.env.DSH_HOME, environment.dshHome);
    assert.equal(environment.env.DSH_TELEMETRY_MODE, "DISABLED");
    assert.notEqual(environment.cwd, process.cwd());
    assert.notEqual(environment.dshHome, process.env.DSH_HOME);
    assert.equal(environment.env.PATH.startsWith(`${environment.stubBinDir}:`), true);
  } finally {
    environment.dispose();
  }
});

test("the case PATH carries a stub specstride whose launch refuses", () => {
  const environment = hermeticEnvironment();
  try {
    let stderr = "";
    let code = 0;
    try {
      execFileSync("specstride", ["run", "--comment", "x"], {
        cwd: environment.cwd,
        env: environment.env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const failure = error as { status?: number; stderr?: string };
      code = failure.status ?? -1;
      stderr = failure.stderr ?? "";
    }
    assert.equal(code, 126);
    assert.equal(stderr.includes(STUB_REFUSAL_LINE), true);
    assert.equal(stderr.includes("[SPECSTRIDE-REFUSE]"), true);
  } finally {
    environment.dispose();
  }
});

test("one case is one `dsh --profile headless` task, run to completion, stopping at the first skill tool result", () => {
  const task = headlessTaskOf("run specstride on the comment 'add rate limiting'");
  assert.deepEqual(task.argv, ["dsh", "--profile", "headless", "run specstride on the comment 'add rate limiting'"]);
  assert.equal(task.runToCompletion, true);
  assert.equal(task.stopsAt, "first skill tool result");
});

test("the per-change build runs the suites on the kit stub runner — model-free, one report per case", () => {
  assert.equal(evalDriverCallsAModel(), false);
  const [runSuite] = loadSuiteFiles();
  const results: Record<string, { invokedSkill: string | null; toolCalls?: string[]; exitCode?: number | null }> = {};
  for (const entry of runSuite.cases) {
    results[entry.id] = {
      invokedSkill: entry.expected,
      toolCalls: entry.expected === null ? ["read"] : ["skill"],
      exitCode: 0,
    };
  }
  const reports = runSuiteOnStub(runSuite, results);
  assert.equal(reports.length, runSuite.cases.length);
  for (const report of reports) {
    assert.equal(report.scored, true);
    assert.equal(report.invokedSkill, report.expected);
    assert.equal(report.gradersPass, true);
  }
});

test("the driver reports an interrupted run and a usage-limit run as NOT SCORED", () => {
  const [runSuite] = loadSuiteFiles();
  const positive = runSuite.cases.find((entry) => entry.kind === "positive")!;
  const negative = runSuite.cases.find((entry) => entry.expected === null)!;
  // The stub refuses a case its record does not hold, so the table covers
  // every case of the suite; two endings are overridden.
  const results: Record<string, { invokedSkill: string | null; toolCalls?: string[]; exitCode?: number | null }> = {};
  for (const entry of runSuite.cases) {
    results[entry.id] = { invokedSkill: entry.expected, toolCalls: ["skill"], exitCode: 0 };
  }
  results[positive.id] = { invokedSkill: positive.expected, toolCalls: ["skill"], exitCode: 130 };
  results[negative.id] = { invokedSkill: null, toolCalls: ["read"], exitCode: 0, marker: "usage-limit" };
  const reports = runSuiteOnStub(runSuite, results);
  const byId = new Map(reports.map((report) => [report.caseId, report]));
  const interrupted = byId.get(positive.id)!;
  assert.equal(interrupted.scored, false);
  assert.equal(interrupted.notScoredReason, "interrupted");
  assert.equal(interrupted.interruptedExitCode, 130);
  const limited = byId.get(negative.id)!;
  assert.equal(limited.scored, false);
  assert.equal(limited.notScoredReason, "usage-limit");
});

test("the suite files: two files, ≥6 positive and ≥6 negative cases each, the confusable pair in both", () => {
  const suites = loadSuiteFiles();
  assert.deepEqual(suites.map((suite) => suite.skill), ["specstride-run", "specstride-reverse"]);
  for (const suite of suites) {
    const positive = suite.cases.filter((entry) => entry.kind === "positive");
    const negative = suite.cases.filter((entry) => entry.kind !== "positive");
    assert.ok(positive.length >= 6, `${suite.skill}: ${positive.length} positive cases`);
    assert.ok(negative.length >= 6, `${suite.skill}: ${negative.length} negative cases`);
    for (const entry of suite.cases) {
      assert.ok("kind" in entry && "prompt" in entry && "expected" in entry && "tools" in entry, entry.id);
    }
    const pair = suite.cases.filter((entry) => entry.confusablePair === DSH_STATIC_RULES.confusablePair);
    assert.ok(pair.length >= 1, `${suite.skill}: the run/reverse confusable pair is present`);
  }
});

test("no model id anywhere in a suite file or the graders file", () => {
  for (const suite of loadSuiteFiles()) {
    assert.equal(containsModelId(suite), false, suite.skill);
  }
  assert.equal(containsModelId(loadGradersFile()), false);
  for (const relative of ["evals/suites/specstride-run.suite.json", "evals/suites/specstride-reverse.suite.json"]) {
    const text = readFileSync(join(ROOT, relative), "utf8");
    assert.equal(/"model/i.test(text), false, relative);
  }
});

test("the static check of this host passes over the real suites and graders", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts?: Record<string, string> };
  const findings = staticFindings(manifest);
  const bad = findings.filter((finding) => !finding.ok);
  assert.deepEqual(bad, []);
  assert.equal(staticCheckCallsAModel(), false);
});

test("a build job that starts the suite runner is refused (F120-FR-025)", () => {
  const offenders = dshStaticCheck.jobsThatStartTheSuiteRunner([
    { declaredIn: 'package.json script "evil"', command: "node evals/trigger-suite.ts" },
    { declaredIn: 'package.json script "test"', command: "node --test tests/**" },
  ]);
  assert.deepEqual(offenders.map((job) => job.declaredIn), ['package.json script "evil"']);
  assert.throws(() => dshStaticCheck.assertNoJobStartsTheSuiteRunner(offenders), SuiteRunnerInBuildError);
  assert.equal(dshStaticCheck.jobsThatStartTheSuiteRunner(buildJobsOf({ scripts: { test: "node --test" } })).length, 0);
});

test("the graders file is all free graders with an empty allow-list and launch impossible", () => {
  const graders = loadGradersFile() as {
    toolRestriction?: { allowedTools: string[]; launchImpossible?: boolean };
    graders: Record<string, { kind: string; modelJudge: boolean }>;
  };
  assert.deepEqual(graders.toolRestriction?.allowedTools, []);
  assert.equal(graders.toolRestriction?.launchImpossible, true);
  const entries = Object.values(graders.graders);
  assert.ok(entries.length > 0);
  for (const grader of entries) {
    assert.equal(grader.kind, "free");
    assert.equal(grader.modelJudge, false);
  }
});
