/**
 * The eval driver glue of the dsh host (T030, F120-FR-023; research.md R9;
 * contracts/eval-driver.md — G-A for the kit types).
 *
 * Per case the HERMETIC environment of contracts/eval-driver.md:
 *   - `DSH_HOME` a temp directory holding ONLY the three rendered skills
 *     (a user-scope install of the tree under test),
 *   - `DSH_TELEMETRY_MODE=DISABLED` (nothing sends or writes telemetry),
 *   - a temp working directory (never the consumer's tree, never this repo),
 *   - a `PATH` carrying a stub `specstride` whose `launch` refuses — the
 *     tool restriction of F120-FR-024 is ENVIRONMENTAL (rc.8 shows no
 *     tool-restriction flag; recorded `unverified` in `src/host-facts.ts`
 *     HF-15 with its settling check).
 *
 * One case = one `dsh --profile headless "<prompt>"` task (`headlessTaskOf`),
 * run to completion; the session stops at the first `skill` tool result
 * (R4 F9). The verdict comes from `src/evals/grader.ts`.
 *
 * The PER-CHANGE BUILD composes with the kit's `evalDriverRun` (its
 * `evalDriverCallsAModel()` is false — asserted at load) over the kit
 * `stubSuiteRunner` replaying recorded results: the build never starts the
 * host runner. The host runner (`hostSuiteRunnerOf`) spawns dsh and calls a
 * model; it exists for the PAID lane a person starts
 * (`src/evals/paid-lane.ts`) and is never run by the build.
 *
 * The kit's evals machinery is REQUIRED: it is reached through the subpath
 * `@specstride/host-kit/evals` of the pinned tarball (research.md R3). If it
 * were missing, the import below fails the build — it is never reimplemented
 * locally.
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evalDriverRun,
  evalDriverCallsAModel,
  stubSuiteRunner,
  staticCheckOf,
  staticCheckCallsAModel,
  type CaseReport,
  type RecordedCaseResult,
  type StaticFinding,
  type TriggerSuiteFile,
  type SuiteRunner,
  type BuildJob,
} from "@specstride/host-kit/evals";
import { gradeFromSessionLog, sessionLogPathOf, type GraderCase } from "./grader.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The kit driver, as the build runs it, calls no model — held at load. */
if (evalDriverCallsAModel() !== false) {
  throw new Error("evalDriverCallsAModel() must be false — the per-change build calls no model (F120-FR-025)");
}
if (staticCheckCallsAModel() !== false) {
  throw new Error("staticCheckCallsAModel() must be false — the static check reads parsed values only");
}

/** The two suite files of this host, one per model-invocable skill. */
export const SUITE_FILES: readonly string[] = [
  "evals/suites/specstride-run.suite.json",
  "evals/suites/specstride-reverse.suite.json",
];

/** The graders file of this host (the kit `FreeGraderFile` shape on disk). */
export const GRADERS_FILE = "evals/suites/graders.json";

/** The kit `TriggerSuiteFile`s of this host, read from `evals/suites/`. */
export function loadSuiteFiles(): readonly TriggerSuiteFile[] {
  return SUITE_FILES.map((relative) =>
    JSON.parse(readFileSync(join(ROOT, relative), "utf8")) as TriggerSuiteFile,
  );
}

/** The graders file, parsed. */
export function loadGradersFile(): unknown {
  return JSON.parse(readFileSync(join(ROOT, GRADERS_FILE), "utf8"));
}

/* -------------------------------------------------------------------------
 * The static check of the suites and of the build configuration (kit
 * `staticCheckOf` over THIS host's rules — no kit default anywhere).
 * ---------------------------------------------------------------------- */

/** The rules of this host's static check (contracts/eval-driver.md). */
export const DSH_STATIC_RULES = {
  positiveCasesPerSkill: 6,
  negativeCasesPerSkill: 6,
  confusablePair: "run-vs-reverse",
  suiteRunnerMarkers: [/trigger-suite/],
  requirementIds: {
    suiteCases: "F120-FR-024",
    noModelId: "F120-FR-024",
    buildNoSuiteRunner: "F120-FR-025",
  },
} as const;

/** The static check of this host, built over the rules above at load. */
export const dshStaticCheck = staticCheckOf(DSH_STATIC_RULES);

/** The jobs of the build configuration, as the kit `BuildJob`s. */
export function buildJobsOf(manifest: {
  scripts?: Record<string, string>;
}): readonly BuildJob[] {
  return Object.entries(manifest.scripts ?? {}).map(([name, command]) => ({
    declaredIn: `package.json script "${name}"`,
    command,
  }));
}

/**
 * The whole static check of the per-change build: the suite files (counts,
 * confusable pair, no model id), the graders file (all free, empty
 * `allowedTools`, launch impossible), and that no job of the build starts
 * the host's suite runner (F120-FR-025).
 */
export function staticFindings(manifest: {
  scripts?: Record<string, string>;
}): readonly StaticFinding[] {
  const findings: StaticFinding[] = [
    ...dshStaticCheck.checkSuiteFiles(
      loadSuiteFiles(),
      loadGradersFile() as Parameters<typeof dshStaticCheck.checkGraders>[0],
    ),
  ];
  const offenders = dshStaticCheck.jobsThatStartTheSuiteRunner(buildJobsOf(manifest));
  findings.push(
    offenders.length === 0
      ? { check: "build-no-suite-runner", ok: true, detail: "no build job starts the host suite runner" }
      : { check: "build-no-suite-runner", ok: false, detail: `${offenders.length} build job(s) would start the suite runner (F120-FR-025)` },
  );
  return findings;
}

/* -------------------------------------------------------------------------
 * The hermetic per-case environment
 * ---------------------------------------------------------------------- */

/** The hermetic environment of one eval case. */
export type HermeticCaseEnvironment = {
  /** The temp `DSH_HOME` holding only the three rendered skills. */
  readonly dshHome: string;
  /** The temp working directory of the case. */
  readonly cwd: string;
  /** The directory of the stub `specstride` (the front of the case `PATH`). */
  readonly stubBinDir: string;
  /** The env a case task runs under. */
  readonly env: Record<string, string>;
  /** Removes the temp dirs. */
  readonly dispose: () => void;
};

/** The stub `specstride` a case PATH carries: its `launch` refuses. */
export const STUB_REFUSAL_LINE =
  "[SPECSTRIDE-REFUSE] action=launch reason=eval-stub the eval lane never launches a run (F120-FR-024)";

/** The three skill spellings a hermetic `DSH_HOME` holds (closed set). */
export const HERMETIC_SKILL_SPELLINGS: readonly string[] = [
  "specstride-run",
  "specstride-reverse",
  "specstride-doctor",
];

/**
 * Builds the hermetic environment of one case: a temp `DSH_HOME` holding
 * only the three rendered skills of `skillsRoot` (default: this package's
 * built `skills/`), `DSH_TELEMETRY_MODE=DISABLED`, a temp working
 * directory, and a `PATH` whose front is a stub `specstride` that refuses.
 */
export function hermeticEnvironment(skillsRoot?: string): HermeticCaseEnvironment {
  const root = skillsRoot ?? join(ROOT, "skills");
  const base = mkdtempSync(join(tmpdir(), "specstride-dsh-eval-"));
  const dshHome = join(base, "dsh-home");
  const cwd = join(base, "work");
  const stubBinDir = join(base, "bin");
  mkdirSync(dshHome);
  mkdirSync(cwd);
  mkdirSync(stubBinDir);
  // DSH_HOME holds ONLY the three rendered skills (a user-scope install).
  mkdirSync(join(dshHome, "skills"));
  for (const spelling of HERMETIC_SKILL_SPELLINGS) {
    cpSync(join(root, spelling), join(dshHome, "skills", spelling), { recursive: true });
  }
  const stubPath = join(stubBinDir, "specstride");
  writeFileSync(
    stubPath,
    "#!/bin/sh\n" +
      `echo "${STUB_REFUSAL_LINE}" >&2\n` +
      "exit 126\n",
    { encoding: "utf8" },
  );
  chmodSync(stubPath, 0o755);
  const env: Record<string, string> = {
    ...cleanEnv(),
    DSH_HOME: dshHome,
    DSH_TELEMETRY_MODE: "DISABLED",
    PATH: `${stubBinDir}:${process.env.PATH ?? ""}`,
  };
  return {
    dshHome,
    cwd,
    stubBinDir,
    env,
    dispose: () => rmSync(base, { recursive: true, force: true }),
  };
}

function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  delete env.DSH_HOME;
  delete env.DSH_TELEMETRY_MODE;
  return env;
}

/**
 * One case task: `dsh --profile headless "<prompt>"`, run to completion;
 * the session stops at the first `skill` tool result (R4 F9). The argv is
 * stated here and handed to the host runner of the paid lane — never
 * started by the build.
 */
export function headlessTaskOf(prompt: string): {
  readonly argv: readonly string[];
  readonly runToCompletion: true;
  readonly stopsAt: "first skill tool result";
} {
  return {
    argv: ["dsh", "--profile", "headless", prompt],
    runToCompletion: true,
    stopsAt: "first skill tool result",
  };
}

/* -------------------------------------------------------------------------
 * The two runners: the stub (the build) and the host (the paid lane)
 * ---------------------------------------------------------------------- */

/**
 * The model-free runner of the per-change build: the kit `stubSuiteRunner`
 * over a recorded result table keyed by this host's case ids. It calls
 * nothing; `evalDriverRun` grades and reports, with an interrupted run and
 * a usage-limit run NOT SCORED.
 */
export function runSuiteOnStub(
  suite: TriggerSuiteFile,
  results: Readonly<Record<string, RecordedCaseResult>>,
): readonly CaseReport[] {
  return evalDriverRun(suite, stubSuiteRunner(results));
}

/**
 * The HOST runner of the paid lane (a person starts it; the build never
 * does): per case it builds the hermetic environment, spawns ONE
 * `dsh --profile headless "<prompt>"` task to completion, and records what
 * the graders read — the invoked skill from the session log, the exit code,
 * and a marker where the run ended on the usage limit.
 */
export function hostSuiteRunnerOf(environmentFor: (prompt: string) => HermeticCaseEnvironment): SuiteRunner {
  return {
    kind: "host",
    runCase(entry): RecordedCaseResult {
      const task = headlessTaskOf(entry.prompt);
      const environment = environmentFor(entry.prompt);
      try {
        const spawned = spawnSync(task.argv[0]!, task.argv.slice(1), {
          cwd: environment.cwd,
          env: environment.env,
          encoding: "utf8",
        });
        const exitCode = spawned.status ?? null;
        const graderCase: GraderCase = {
          expected: entry.expected,
          exitCode,
          dshHome: environment.dshHome,
        };
        const verdict = gradeFromSessionLog(graderCase);
        return {
          invokedSkill: verdict === "matched" ? entry.expected : null,
          toolCalls: [task.argv.join(" ")],
          exitCode,
        };
      } finally {
        environment.dispose();
      }
    },
  };
}

/**
 * True where the hermetic `DSH_HOME` holds exactly the three rendered
 * skills and nothing else — the shape the contract pins. Used by the
 * driver tests to observe the environment, never a verdict.
 */
export function dshHomeHoldsOnlyTheThreeSkills(dshHome: string): boolean {
  const skillsDir = join(dshHome, "skills");
  if (!existsSync(skillsDir)) return false;
  const entries = readdirSync(skillsDir).sort();
  const expected = [...HERMETIC_SKILL_SPELLINGS].sort();
  if (entries.join(",") !== expected.join(",")) return false;
  for (const spelling of HERMETIC_SKILL_SPELLINGS) {
    const path = join(skillsDir, spelling, "SKILL.md");
    if (!existsSync(path) || !statSync(path).isFile()) return false;
  }
  return existsSync(sessionLogPathOf(dshHome)) === false;
}
