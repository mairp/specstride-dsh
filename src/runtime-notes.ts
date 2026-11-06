/**
 * The dsh runtime lines (T005, F120-FR-013, F120-FR-014, F120-FR-017;
 * research.md R5) — the only prose this package owns, held as DATA: one row
 * per generated line. `scripts/build.ts` renders these rows into the dsh
 * runtime section it appends to the run and reverse bodies BEFORE the kit's
 * budget check runs, so the lines are paid out of the F120-FR-026 budgets.
 *
 * No kit import: pure data, writable before the gate on the pinned tarballs.
 */

/** Which skill a generated line belongs to. */
export type RuntimeLineScope = "run" | "reverse" | "both";

/** One row of the table: one generated line, nothing else. */
export type RuntimeLine = {
  /** A stable id, which the attribution check names. */
  readonly id: string;
  /** The line, as it lands in the composed body (one Markdown bullet). */
  readonly line: string;
  /** The skill whose body carries the line. */
  readonly scope: RuntimeLineScope;
  /** The requirement that fixes the line. */
  readonly requirement: string;
};

export const dshRuntimeLines: readonly RuntimeLine[] = Object.freeze([
  {
    id: "dsh-launch-foreground",
    line:
      "Run the `specstride launch` step as a FOREGROUND shell call; `run_in_background: true` is forbidden for it — the launch must return in the foreground with its outcome line.",
    scope: "both",
    requirement: "F120-FR-013",
  },
  {
    id: "dsh-detached-survival",
    line:
      "The run survives the end of the dsh session because the engine detaches it at start, never because of a dsh job: dsh jobs are owned by the calling session and die with it.",
    scope: "both",
    requirement: "F120-FR-013",
  },
  {
    id: "dsh-shim-bin",
    line:
      "Run every `specstride <cmd>` this skill spells through this package's shim, bin `specstride-dsh` — i.e. `specstride-dsh <cmd>` — never a `specstride` found by hand.",
    scope: "both",
    requirement: "F120-FR-013",
  },
  {
    id: "dsh-wait-background",
    line:
      "A supervision `wait` MAY run as a dsh background job while the session lives; losing it loses nothing, and a lost output is recovered by repeating the read.",
    scope: "both",
    requirement: "F120-FR-013",
  },
  {
    id: "dsh-state-home-not-writable",
    line:
      "If the doctor found the state home not writable, the needed permission mode is `DSH_PERMISSION_MODE=danger-full-access` (or a writable root that includes the state home, where the installed dsh supports one): state that in one line, and change no setting yourself.",
    scope: "run",
    requirement: "F120-FR-017",
  },
]);

/** The lines for one skill, in table order. */
export function dshRuntimeLinesFor(scope: "run" | "reverse"): readonly RuntimeLine[] {
  return dshRuntimeLines.filter(
    (row) => row.scope === scope || row.scope === "both",
  );
}

/** The generated dsh runtime section for one skill: heading plus one bullet per line. */
export function dshRuntimeSectionFor(scope: "run" | "reverse"): readonly string[] {
  return [
    "### dsh runtime notes",
    "",
    ...dshRuntimeLinesFor(scope).map((row) => `- ${row.line}`),
    "",
  ];
}
