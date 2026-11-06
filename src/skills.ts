/**
 * The skill-set binding (T007, F120-FR-001, F120-FR-004, F120-FR-026;
 * research.md R4, R5).
 *
 * Assembles the kit `SkillSetHost` input: the kit's three skill sources
 * (`runSkillSourceOf`, `reverseSkillSourceOf`, `doctorSkillSourceOf`) over
 * the dsh figures of `src/profile.ts`, `src/host-facts.ts` and
 * `src/runtime-notes.ts`, rendered with the kit's set machinery. The bodies
 * this module composes are the kit's own texts plus the generated dsh
 * runtime section — the package holds no second hand-written copy of a skill
 * body (F120-FR-004).
 */
import {
  audienceNoticeSectionOf,
  bodyBudgetsOf,
  dataFramingSection,
  doctorSkillBody,
  doctorSkillSourceOf,
  DOCTOR_SKILL_DESCRIPTION,
  DOCTOR_SKILL_LOGICAL_ID,
  judgmentSectionOf,
  JUDGMENT_BATCH_TOKEN_CAP,
  prohibitionsOf,
  prohibitionSectionOf,
  PROHIBITION_TEXTS,
  reverseSkillBodyOf,
  reverseSkillSourceOf,
  REVERSE_SKILL_DESCRIPTION,
  RUN_SKILL_DESCRIPTION,
  runSkillBodyOf,
  runSkillSourceOf,
  supervisionSectionOf,
  type SkillSetHost,
  type SkillSource,
} from "@specstride/host-kit";
import { dshProfile, dshTokenBudgets } from "./profile.ts";
import { DSH_VERSION_PIN } from "./host-facts.ts";
import { dshRuntimeSectionFor } from "./runtime-notes.ts";

/** The logical ids of the set, in the order the build writes them. */
export const DSH_SKILL_IDS = Object.freeze([
  "specstride-run",
  "specstride-reverse",
  "doctor",
]);

/** Where the audience-notice marker lives on dsh (research.md R12). */
export const DSH_MARKER_DIRECTORY = "$DSH_HOME/specstride-host/markers/";

/**
 * The traceability of the kit's prohibition texts for this host: the
 * requirement that fixes each text and the behaviour row it was translated
 * from. The map must name every text exactly once (the kit holds this).
 */
const PROHIBITION_TRACEABILITY: Readonly<
  Record<string, { requirement: string; origin: string | null }>
> = Object.freeze({
  "no-repository-write": { requirement: "F120-FR-009", origin: "B-09" },
  "no-verification-file": { requirement: "F120-FR-009", origin: null },
  "no-cli-search": { requirement: "F120-FR-009", origin: null },
  "logical-names-only": { requirement: "F120-FR-009", origin: null },
  "no-launcher-edit": { requirement: "F120-FR-009", origin: null },
  "supervision-reads-only": { requirement: "F120-FR-010", origin: null },
});

/** The five shared sections every host source takes, over the dsh figures. */
export function dshSkillSections() {
  const judgment = judgmentSectionOf({ delegatesToAHarness: false });
  const supervision = supervisionSectionOfDsh();
  const audienceNotice = audienceNoticeSectionOf({
    harnessClause: `On dsh the model harness is dsh itself (the session's model; dsh ${DSH_VERSION_PIN})`,
    authTier:
      "the session's own approval tier: `workspace-write` with `ask` by default, `danger-full-access` when set so",
  });
  const dataFraming = dataFramingSection();
  const prohibitions = prohibitionSectionOf(
    prohibitionsOf(PROHIBITION_TRACEABILITY),
  );
  return { judgment, supervision, audienceNotice, dataFraming, prohibitions };
}

/**
 * The judgment exchange on dsh (F120-FR-008, R4 Q2): the host HAS a model
 * (`model: true` of `src/describe.ts`), so the judgment is never delegated
 * to a harness; batches may go to a dsh subagent where the count is large
 * (the kit's own clause, carried by `judgmentSectionOf(false)`), never the
 * exchange as a whole.
 */
export const DSH_JUDGMENT_DELEGATES_TO_A_HARNESS = false;
export const DSH_JUDGMENT_MAY_DELEGATE_BATCHES_TO_A_SUBAGENT = true;

/**
 * The supervision section's dsh figures (F120-FR-026): one cycle 150 tokens,
 * an unchanged cycle 0, a whole run's supervision 3,000 — and the wait MAY
 * run as a dsh background job while the session lives (F120-FR-013).
 */
function supervisionSectionOfDsh(): readonly string[] {
  // The kit's own builder writes the section over the figures; the dsh
  // background primitive exists (dsh jobs, HF-06), so the wait may be a job.
  return supervisionSectionOf({
    backgroundPresent: true,
    cycleTokenBudget: dshTokenBudgets["supervision-cycle"],
    runSupervisionTokenBudget: dshTokenBudgets["supervision-run"],
  });
}

/** The body-budget check keyed by logical id, bound to the dsh tables. */
export const dshBodyBudgets = bodyBudgetsOf({
  bodyTokenLimits: {
    "specstride-run": dshTokenBudgets["specstride-run"],
    "specstride-reverse": dshTokenBudgets["specstride-reverse"],
    doctor: dshTokenBudgets.doctor,
  },
  printedBodyByteLimits: {
    "specstride-run": dshProfile.printedByteBudgets["specstride-run"],
    "specstride-reverse": dshProfile.printedByteBudgets["specstride-reverse"],
    doctor: dshProfile.printedByteBudgets.doctor,
  },
  bytesPerToken: dshProfile.bytesPerToken,
  designPoint:
    "F120-FR-026: the budgets of feature 113 (run 8,000 tokens, reverse 7,000, doctor 1,500), measured at 2.8 bytes per token",
});

/** The kit body of the run skill, under the dsh sections and budgets. */
export function dshRunKitBody(): string {
  return runSkillBodyOf({
    sections: dshSkillSections(),
    oldModeNamesLine:
      "Modes: `run` (the default) and `dry-run`; there is no predecessor skill on this host — a dry run derives, validates, prints the plan and launches nothing (F120-FR-006).",
  });
}

/** The composed run body: the kit body + the generated dsh runtime section. */
export function dshRunBody(): string {
  return [dshRunKitBody(), "", ...dshRuntimeSectionFor("run")].join("\n");
}

/** The composed reverse body, likewise. */
export function dshReverseKitBody(): string {
  return reverseSkillBodyOf({ sections: dshSkillSections() });
}

export function dshReverseBody(): string {
  return [dshReverseKitBody(), "", ...dshRuntimeSectionFor("reverse")].join("\n");
}

/** The doctor body: the kit's own, with NO appendix yet (that lands with T021). */
export function dshDoctorBody(): string {
  return doctorSkillBody();
}

function budgetsFor(logicalId: string) {
  return {
    totalBytes: dshProfile.printedByteBudgets[logicalId],
    assertBodyFitsItsLimit: (id: string, body: string) =>
      dshBodyBudgets.assertBodyFitsItsLimit(id, body),
  };
}

/** The source of one skill, with the composed body, as `renderSkill` takes it. */
export function dshSkillSourceOf(logicalId: string): SkillSource {
  const body =
    logicalId === "specstride-run"
      ? dshRunBody()
      : logicalId === "specstride-reverse"
        ? dshReverseBody()
        : dshDoctorBody();
  if (logicalId === "specstride-run" || logicalId === "specstride-reverse") {
    // The composed body passes the body-limit check BEFORE the render — the
    // dsh lines are paid out of the F120-FR-026 budgets (research.md R5).
    dshBodyBudgets.assertBodyFitsItsLimit(logicalId, body);
  }
  const kitSource =
    logicalId === "specstride-run"
      ? runSkillSourceOf({
          sections: dshSkillSections(),
          oldModeNamesLine:
            "Modes: `run` (the default) and `dry-run`; there is no predecessor skill on this host — a dry run derives, validates, prints the plan and launches nothing (F120-FR-006).",
          budgets: budgetsFor(logicalId),
        })
      : logicalId === "specstride-reverse"
        ? reverseSkillSourceOf({ sections: dshSkillSections(), budgets: budgetsFor(logicalId) })
        : doctorSkillSourceOf(budgetsFor(logicalId));
  return { ...kitSource, body };
}

/** The kit `SkillSetHost` input of this host: sources, descriptions, profile. */
export function dshSkillSetHost(): SkillSetHost {
  return {
    sources: DSH_SKILL_IDS.map((id) => dshSkillSourceOf(id)),
    descriptions: {
      "specstride-run": RUN_SKILL_DESCRIPTION,
      "specstride-reverse": REVERSE_SKILL_DESCRIPTION,
      doctor: DOCTOR_SKILL_DESCRIPTION,
    },
    profile: dshProfile,
  };
}

/** The kit's batch cap of the judgment exchange, as this host declares it (F120-FR-008). */
export const DSH_JUDGMENT_BATCH_TOKEN_CAP = JUDGMENT_BATCH_TOKEN_CAP;
