/**
 * The HostPort object of the dsh host (T032, F120-FR-001, F120-FR-015;
 * contracts/host-package.md — G-A for the shapes, read from the pinned
 * contracts, never restated).
 *
 * `{host: "dsh", port: "specstride.host/1", protocol: 1}` with:
 *   - `describe`   — `src/describe.ts` (the six capability declarations of
 *                    annex H §H.1; it never calls the engine);
 *   - `renderSkill` — the `src/skills.ts` binding over the `src/profile.ts`
 *                    profile (the kit `renderSkill` over a dsh source);
 *   - `renderEntry` — the same binding; ENTRY ONLY for the two
 *                    model-invocable skills (F120-FR-001): the doctor's
 *                    logical id and any unknown id refuse;
 *   - `evalDriver.run` — `src/evals/driver.ts` (the hermetic headless
 *                    session of R9, graded from the session log);
 *   - `renderStatusHooks` — DECLARED ABSENT (F120-FR-015): the property does
 *                    not exist on the object, so a call goes down the port's
 *                    `capability-absent` path (EP-01); this module also
 *                    exports the refusal line a caller that pre-checks gets.
 */
import {
  CLI_PROTOCOL_VERSION,
  POINT_ID,
  HOST_SKILL_IDS,
  renderEntry,
  renderSkill,
  UnknownLogicalIdError,
  unknownLogicalIdMessage,
  type HostArtifact,
  type HostDescription,
  type HostPort,
  type SkillSource,
} from "@specstride/host-kit";
import { describeOfDsh } from "./describe.ts";
import { dshProfile } from "./profile.ts";
import { dshSkillSourceOf, dshSkillSetHost } from "./skills.ts";
import {
  headlessTaskOf,
  hermeticEnvironment,
  hostSuiteRunnerOf,
  type HermeticCaseEnvironment,
} from "./evals/driver.ts";
import { gradeFromSessionLog, type GraderCase } from "./evals/grader.ts";
import type { TriggerCase } from "@specstride/contracts/ep/host";
import { spawnSync } from "node:child_process";

/** The host name and port id of this package, as the port spells them. */
export const DSH_HOST_NAME = "dsh" as const;
export const DSH_PORT_ID = POINT_ID; // "specstride.host/1" — read, never restated
export const DSH_PROTOCOL = CLI_PROTOCOL_VERSION; // 1

/** The one error name of EP-01 an absent operation surfaces. */
export const CAPABILITY_ABSENT = "capability-absent" as const;

/** The refusal line a caller of the absent `renderStatusHooks` receives. */
export function capabilityAbsentLine(operation: string): string {
  return `[SPECSTRIDE-REFUSE] action=${operation} reason=${CAPABILITY_ABSENT} host=${DSH_HOST_NAME} port=${DSH_PORT_ID}`;
}

/** The logical ids whose entry point the port renders (the two model-invocable skills). */
export const DSH_ENTRY_IDS: readonly string[] = HOST_SKILL_IDS;

/** The doctor's logical id: it has no entry point on dsh (F120-FR-001). */
export const DOCTOR_HAS_NO_ENTRY =
  "the doctor skill is invoked by hand on dsh — it has no model-invocable entry point (F120-FR-001)";

/**
 * One case run of `evalDriver.run`: the hermetic headless session of R9,
 * graded from the session log only. The runner is injectable so the
 * conformance suite and the tests drive the port with STUB AGENTS on oracle
 * fixtures (stub `dsh` and stub `specstride` on PATH — zero paid call);
 * the default builds the real hermetic environment.
 */
export type PortEvalOptions = {
  /** Environment factory per prompt; defaults to the real hermetic one. */
  readonly environmentFor?: (prompt: string) => HermeticCaseEnvironment;
};

async function runEvalSuite(
  suite: readonly TriggerCase[],
  options?: PortEvalOptions,
): Promise<
  readonly { readonly id: string; readonly matched: boolean; readonly detail: string }[]
> {
  const environmentFor = options?.environmentFor ?? (() => hermeticEnvironment());
  return suite.map((entry) => {
    const task = headlessTaskOf(entry.prompt);
    const environment = environmentFor(entry.prompt);
    try {
      // One `dsh --profile headless "<prompt>"` task per case, run to
      // completion; the session stops at the first skill tool result (R4 F9).
      const spawned = spawnSync(task.argv[0]!, task.argv.slice(1), {
        cwd: environment.cwd,
        env: environment.env,
        encoding: "utf8",
      });
      const graderCase: GraderCase = {
        expected: entry.expected,
        exitCode: spawned.status ?? 0,
        dshHome: environment.dshHome,
      };
      const verdict = gradeFromSessionLog(graderCase);
      return {
        id: entry.id,
        matched: verdict === "matched",
        detail: `graded from the session log under the hermetic DSH_HOME: ${verdict}`,
      };
    } finally {
      environment.dispose();
    }
  });
}

/**
 * The HostPort of EP-01 as this package offers it. `renderStatusHooks` is
 * deliberately not present on the returned object — the property is
 * `undefined`, which is the port's declared-absent form (F120-FR-015); a
 * caller that probes first gets `capabilityAbsentLine("renderStatusHooks")`.
 */
export function dshHostPort(options?: PortEvalOptions): HostPort & {
  readonly host: typeof DSH_HOST_NAME;
  readonly port: typeof DSH_PORT_ID;
  readonly protocol: typeof DSH_PROTOCOL;
} {
  const host = dshSkillSetHost();
  return {
    host: DSH_HOST_NAME,
    port: DSH_PORT_ID,
    protocol: DSH_PROTOCOL,
    describe(): HostDescription {
      return describeOfDsh();
    },
    renderSkill(source: SkillSource): HostArtifact {
      // The binding over the dsh profile: the source must be one of this
      // set's logical ids, and the render is the kit's own.
      const known = host.sources.some((candidate) => candidate.logicalId === source.logicalId);
      if (!known) throw new UnknownLogicalIdError(source.logicalId);
      return renderSkill(dshSkillSourceOf(source.logicalId), dshProfile);
    },
    renderEntry(logicalId: string): string {
      if (!(DSH_ENTRY_IDS as readonly string[]).includes(logicalId)) {
        if (logicalId === "doctor") {
          throw new Error(capabilityAbsentLine("renderEntry") + " — " + DOCTOR_HAS_NO_ENTRY);
        }
        throw new UnknownLogicalIdError(logicalId, unknownLogicalIdMessage(logicalId));
      }
      return renderEntry(logicalId, dshProfile);
    },
    evalDriver: {
      run(suite: readonly TriggerCase[]) {
        return Promise.resolve(runEvalSuite(suite, options));
      },
    },
  };
}

/**
 * The default port runner of the paid lane (the person-started suite run):
 * the hermetic environment per case and one `dsh --profile headless` task,
 * never started by the build. Exposed for `src/evals/paid-lane.ts` and the
 * live probe; the build asserts it never reaches this.
 */
export function dshPortHostRunner(): ReturnType<typeof hostSuiteRunnerOf> {
  return hostSuiteRunnerOf((prompt) => {
    void prompt;
    return hermeticEnvironment();
  });
}
