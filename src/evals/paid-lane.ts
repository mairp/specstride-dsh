/**
 * The paid lane and the release gate (T031, F120-FR-024, F120-FR-025;
 * contracts/eval-driver.md "Release gate").
 *
 * The `eval` subcommand of `bin/specstride-host-dsh.mjs` is the
 * PERSON-STARTED paid lane: it starts the trigger-suite run and the live
 * probe on the person's credential and appends kit `PaidRunRecord`s to the
 * run log. The per-change build NEVER runs it (F120-FR-025): no script of
 * package.json names it (held by the static check's
 * `assertNoJobStartsTheSuiteRunner` in `src/evals/driver.ts`).
 *
 * The release gate is the kit `releaseCheckOf` over the required
 * `ReleaseCheckRules` supplied HERE — no kit default anywhere: the release's
 * own log task, threshold 0.8, three required runs, requirementId
 * F120-FR-024, and the paid task names of this host (the suite run and the
 * live probe of F120-FR-030). The gate reads records only and calls no
 * model. A release is not made unless the gate holds a 0.8-over-3-runs log
 * on that release's skill texts, matched by `skillTextsHashOf`.
 *
 * Records travel through the kit `isPaidRunRecord` / `appendRunRecord` /
 * `readRunLog` with model ids FROM THE RUN'S CONFIGURATION
 * (`modelIdsFromConfiguration` — never written in a suite file), the call
 * count, the cost and `skillTextsHashOf`. A configuration that names no
 * model is refused BEFORE ANY CALL with `RunRefusedError`.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RunRefusedError,
  appendRunRecord,
  howARunEnded,
  isPaidRunRecord,
  modelIdsFromConfiguration,
  readRunLog,
  releaseCheckOf,
  releaseCheckCallsAModel,
  skillTextsHashOf,
  type PaidRunRecord,
  type ReleaseVerdict,
  type SkillResult,
} from "@specstride/host-kit/evals";
import { hostSuiteRunnerOf, hermeticEnvironment, loadSuiteFiles } from "./driver.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

if (releaseCheckCallsAModel() !== false) {
  throw new Error("releaseCheckCallsAModel() must be false — the release gate reads records only");
}

/** The paid task names of this host: the suite run and the live probe. */
export const PAID_TASK_NAMES: readonly string[] = [
  "trigger-suite-dsh",
  "live-probe-dsh",
] as const;

/** The paid task the release gate reads: the release's own suite run. */
export const RELEASE_GATE_TASK = "trigger-suite-dsh";

/** The required `ReleaseCheckRules` of this host — no kit default. */
export const DSH_RELEASE_CHECK_RULES = {
  paidTaskNames: PAID_TASK_NAMES,
  task: RELEASE_GATE_TASK,
  threshold: 0.8,
  requiredRuns: 3,
  requirementId: "F120-FR-024",
} as const;

/** The kit release check of this host, built over those rules at load. */
export const dshReleaseCheck = releaseCheckOf(DSH_RELEASE_CHECK_RULES);

/** Where the paid lane appends its records (overridable for tests). */
export function runLogPathOf(logPath?: string): string {
  return logPath ?? join(ROOT, "evals", "run-log.jsonl");
}

/** The skill texts of the release, joined in the order of row 144. */
export function skillTextsOfRelease(skillsRoot?: string): readonly string[] {
  const root = skillsRoot ?? join(ROOT, "skills");
  return ["specstride-run", "specstride-reverse", "specstride-doctor"].map((spelling) =>
    readFileSync(join(root, spelling, "SKILL.md"), "utf8"),
  );
}

/** The hash of the release's skill texts, as the records carry it. */
export function skillTextsHashOfRelease(skillsRoot?: string): string {
  return skillTextsHashOf(skillTextsOfRelease(skillsRoot));
}

/** One configuration of a paid run, given by the person who starts it. */
export type PaidRunConfiguration = {
  /** The model ids the run uses — from the person's configuration. */
  readonly modelIds?: readonly string[];
  /** The judge model ids, where the run grades with a judge. */
  readonly judgeModelIds?: readonly string[];
};

/**
 * Refuses a configuration that names no model BEFORE ANY CALL: the refusal
 * is the kit `RunRefusedError` and nothing has been started when it throws.
 */
export function refuseWithoutAModel(configuration: PaidRunConfiguration): readonly string[] {
  const modelIds = modelIdsFromConfiguration(configuration);
  if (modelIds.length === 0) {
    throw new RunRefusedError(
      "the configuration of the run names no model — the paid lane refuses before any call",
    );
  }
  return modelIds;
}

/** One recorded score of one skill in a paid run. */
export function skillResultOf(skill: string, scores: readonly number[], notScored: readonly { skill: string; reason: PaidRunRecord["runsNotScored"][number]["reason"] }[]): SkillResult {
  const skillNotScored = notScored.filter((entry) => entry.skill === skill);
  return {
    skill,
    scores,
    scored: skillNotScored.length === 0,
    ...(skillNotScored.length > 0 ? { notScoredReason: skillNotScored[0]!.reason } : {}),
  };
}

/**
 * The paid trigger-suite run: a PERSON starts it (never the build, never a
 * schedule). It refuses without a model, runs every case of both suites
 * through the host runner on the hermetic environment, and appends ONE
 * record per run to the log. `calls` is the number of cases the run drove;
 * `cost` is the cost the person's run reports.
 */
export function paidSuiteRunMain(args: readonly string[]): number {
  const parsed = parsePaidArgs(args);
  const modelIds = refuseWithoutAModel(parsed.configuration);
  const logPath = runLogPathOf(parsed.runLogPath);
  const suites = loadSuiteFiles();
  const runner = hostSuiteRunnerOf(() => hermeticEnvironment());
  let calls = 0;
  const resultPerSkill: SkillResult[] = [];
  const runsNotScored: PaidRunRecord["runsNotScored"] = [];
  for (const suite of suites) {
    const scores: number[] = [];
    for (const entry of suite.cases) {
      calls += 1;
      const recorded = runner.runCase(entry);
      // Not scored is decided ONLY by the kit `howARunEnded` — no local pattern.
      const ended = howARunEnded(recorded.exitCode ?? null, recorded.marker);
      if (ended === "scored") {
        const hit = recorded.invokedSkill !== null && recorded.invokedSkill === entry.expected;
        scores.push(entry.kind === "positive" || entry.kind === "cross-skill" ? (hit ? 1 : 0) : hit ? 0 : 1);
      } else {
        runsNotScored.push({
          skill: suite.skill,
          reason: ended,
        });
      }
    }
    resultPerSkill.push(skillResultOf(suite.skill, scores, runsNotScored));
  }
  const record: PaidRunRecord = {
    date: new Date().toISOString(),
    task: RELEASE_GATE_TASK,
    modelIds,
    calls,
    cost: parsed.cost,
    skillTextsHash: skillTextsHashOfRelease(),
    resultPerSkill,
    runsNotScored,
  };
  if (!isPaidRunRecord(record, PAID_TASK_NAMES)) {
    throw new Error("the paid lane built a record the kit guard rejects — refusing to write it");
  }
  appendRunRecord(logPath, record);
  console.log(`paid run recorded: task ${record.task}, calls ${record.calls}, log ${logPath}`);
  return 0;
}

/** The release gate: reads the log, matches the hash, returns the verdict. */
export function releaseGateOf(
  log: readonly unknown[],
  options: { readonly skillTextsHash?: string } = {},
): ReleaseVerdict {
  const hash = options.skillTextsHash ?? skillTextsHashOfRelease();
  return dshReleaseCheck(log, { skillTextsHash: hash });
}

/** `release-gate` mode of the eval subcommand: reads records only. */
export function releaseGateMain(args: readonly string[]): number {
  const parsed = parsePaidArgs(args);
  const logPath = runLogPathOf(parsed.runLogPath);
  const log = existsSync(logPath) ? readRunLog(logPath, PAID_TASK_NAMES) : [];
  const verdict = releaseGateOf(log);
  console.log(`release gate (${DSH_RELEASE_CHECK_RULES.requirementId}): ${verdict.passed ? "PASS" : "FAIL"} — ${verdict.reason}`);
  return verdict.passed ? 0 : 1;
}

type PaidArgs = {
  readonly configuration: PaidRunConfiguration;
  readonly runLogPath?: string;
  readonly cost: string;
};

function parsePaidArgs(args: readonly string[]): PaidArgs {
  let modelIds: string[] | undefined;
  let runLogPath: string | undefined;
  let cost = "0";
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--model") {
      modelIds ??= [];
      modelIds.push(args[++index] ?? "");
    } else if (arg === "--model-ids") {
      modelIds = (args[++index] ?? "").split(",").map((id) => id.trim()).filter((id) => id.length > 0);
    } else if (arg === "--run-log") {
      runLogPath = args[++index];
    } else if (arg === "--cost") {
      cost = args[++index] ?? "0";
    }
  }
  return { configuration: { modelIds }, runLogPath, cost };
}

/**
 * The `eval` subcommand. WITHOUT a person's explicit mode it prints the one
 * paid-lane line and exits non-zero — it never starts anything on its own,
 * and the modes that spend (`suite-run`) refuse before any call when the
 * configuration names no model.
 */
export function evalMain(args: readonly string[]): number {
  const [mode] = args;
  if (mode === "suite-run") {
    const rest = args.slice(1);
    const hasAModel = modelIdsFromConfiguration({ modelIds: modelIdsOf(rest) }).length > 0;
    if (!hasAModel) {
      throw new RunRefusedError(
        "the configuration names no model — the paid lane refuses before any call (RunRefusedError)",
      );
    }
    return paidSuiteRunMain(rest);
  }
  if (mode === "release-gate") {
    return releaseGateMain(args.slice(1));
  }
  console.error(
    "specstride-host-dsh eval: the paid lane (F120-FR-024) is started by a PERSON, never by the build — " +
      "usage: eval suite-run --model-ids <ids> [--run-log <path>] | eval release-gate [--run-log <path>]",
  );
  return 3;
}

function modelIdsOf(args: readonly string[]): readonly string[] | undefined {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--model-ids") {
      return (args[index + 1] ?? "").split(",").map((id) => id.trim()).filter((id) => id.length > 0);
    }
  }
  return undefined;
}

/** Re-exported for the tests: the log read back through the kit reader. */
export { readRunLog, isPaidRunRecord };

/** The skill spellings the release hashes (re-derivation guard for tests). */
export const ROW_144_ORDER: readonly string[] = ["specstride-run", "specstride-reverse", "specstride-doctor"];

/** True where a directory holds the three rendered skills. */
export function holdsTheThreeSkills(root: string): boolean {
  const entries = readdirSync(root);
  return ROW_144_ORDER.every((spelling) => entries.includes(spelling));
}
