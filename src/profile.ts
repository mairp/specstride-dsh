/**
 * The dsh render profile (T003, F120-FR-001, F120-FR-026; research.md R4).
 *
 * One `SkillRenderProfile` of `@specstride/host-kit` — the kit renders, the
 * host supplies its tables. Every figure here is either read from the kit or
 * held by the kit's load-time arithmetic (`assertBudgetTables`), so the
 * printed byte numbers cannot drift from the token budgets at 2.8 bytes per
 * token. An unknown logical id fails the build through the kit's
 * `UnknownLogicalIdError` / `unknownLogicalIdMessage` (F120-FR-001).
 */
import {
  assertBudgetTables,
  byteBudgetsOf,
  isLogicalId,
  type SkillRenderProfile,
  UnknownLogicalIdError,
} from "@specstride/host-kit";

/** The budget requirement the `budget-exceeded` message names (the spec's own id). */
export const DSH_BUDGET_REQUIREMENT = "F120-FR-026";

/**
 * The dsh spellings of the row-144 logical ids, held line-for-line against
 * `specs/120-host-dsh/contracts/closed-sets.json` (set `dsh-skill-spellings`):
 * dsh has no colon namespace, so the spelling is the whole directory name,
 * and the doctor's logical id is `doctor`, spelled `specstride-doctor`.
 * `scripts/build.ts` holds this table against the closed-set file at build.
 */
export const dshSpellings: Readonly<Record<string, string>> = Object.freeze({
  "specstride-run": "specstride-run",
  "specstride-reverse": "specstride-reverse",
  doctor: "specstride-doctor",
});

/**
 * The five budget figures of feature 113, which F120-FR-026 fixes onto this
 * host: the whole rendered skill budgets for the three skills (from
 * invocation to launch, per the 113 design point) and the two supervision
 * figures (one cycle 150 tokens, an unchanged cycle 0, a whole run's
 * supervision 3,000).
 */
export const dshTokenBudgets: Readonly<Record<string, number>> = Object.freeze({
  "specstride-run": 8_000,
  "specstride-reverse": 7_000,
  doctor: 1_500,
  "supervision-cycle": 150,
  "supervision-run": 3_000,
});

/** An unchanged cycle costs nothing (the kit's own constant, restated nowhere). */
export const DSH_UNCHANGED_CYCLE_TOKENS = 0;

/**
 * The byte numbers F120-FR-026 prints beside the token budgets, at the rate
 * below — held against the arithmetic at load by `assertBudgetTables`.
 * 8,000 × 2.8 = 22,400; 7,000 × 2.8 = 19,600; 1,500 × 2.8 = 4,200;
 * 150 × 2.8 = 420; 3,000 × 2.8 = 8,400.
 */
export const dshPrintedByteBudgets: Readonly<Record<string, number>> =
  Object.freeze({
    "specstride-run": 22_400,
    "specstride-reverse": 19_600,
    doctor: 4_200,
    "supervision-cycle": 420,
    "supervision-run": 8_400,
  });

/**
 * The one dsh render profile. `descriptionCap` is the dsh catalog cap, 500 —
 * NOT Claude's 1,536 (R4 F6); the two model-invocable descriptions together
 * stay within 1,000 characters (F120-FR-026), which the build measures.
 */
export const dshProfile: SkillRenderProfile = Object.freeze({
  bytesPerToken: 2.8,
  maxBodyLines: 500,
  skillFile: "SKILL.md",
  skillsDirectory: "skills",
  descriptionCap: 500,
  spellings: dshSpellings,
  tokenBudgets: dshTokenBudgets,
  printedByteBudgets: dshPrintedByteBudgets,
  budgetRequirement: DSH_BUDGET_REQUIREMENT,
});

/** The byte budgets of the profile, computed once at load. */
export const dshByteBudgets: Readonly<Record<string, number>> =
  byteBudgetsOf(dshProfile);

// Load-time drift check: the printed figures must equal the arithmetic.
assertBudgetTables(dshProfile);

/**
 * The token budget of a logical id of this host, or `undefined` where the
 * profile names none — the profile is the only table of budgets there is.
 * An unknown logical id fails (the kit's own refusal, surfacing here so a
 * caller cannot miss it); the two supervision figures are read by id.
 */
export function dshBudgetTokensOf(key: string): number | undefined {
  if (!isLogicalId(key) && !(key in dshTokenBudgets)) {
    // Fail the build with the contracts' own words (F120-FR-001).
    throw new UnknownLogicalIdError(key);
  }
  return dshTokenBudgets[key];
}
