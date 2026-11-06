/**
 * The dsh runtime lines (T005, F120-FR-013, F120-FR-014, F120-FR-017;
 * research.md R5) — the only prose this package owns, held as DATA: one row
 * per generated line. `scripts/build.ts` renders these rows into the dsh
 * runtime section it appends to the run and reverse bodies BEFORE the kit's
 * budget check runs, so the lines are paid out of the F120-FR-026 budgets.
 *
 * No kit import: pure data, writable before the gate on the pinned tarballs
 * (the appendix builder reads only this feature's contract file).
 */
import { readFileSync } from "node:fs";

/** Which skill a generated line belongs to. */
export type RuntimeLineScope = "run" | "reverse" | "both" | "doctor";

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
    id: "dsh-status-first-on-reinvoke",
    line:
      "When this skill is invoked again while a run lives or after one ended, read `specstride-dsh status` first and relay its one line, verbatim, before anything else: a live run is then supervised, and an ended run is followed by the digest, and the skill stops — no wait is spent on a run that already ended.",
    scope: "run",
    requirement: "F120-FR-010",
  },
  {
    id: "dsh-state-home-not-writable",
    line:
      "If the doctor found the state home not writable, the needed permission mode is `DSH_PERMISSION_MODE=danger-full-access` (or a writable root that includes the state home, where the installed dsh supports one): state that in one line, and change no setting yourself.",
    scope: "run",
    requirement: "F120-FR-017",
  },
]);

/**
 * The generated dsh host-checks appendix of the doctor body (T021,
 * F120-FR-016; R5 item 3): built from the check table of
 * `specs/120-host-dsh/contracts/doctor-host-checks.md` — one bullet per
 * table row, the observation the row names — plus the two relay lines: the
 * CLI's own `specstride doctor` first (its `--json` for the structured reads
 * only), then this package's `specstride-host-dsh doctor`, each finding
 * relayed in the doctor's line grammar. It installs and updates nothing (kit
 * `INSTALLS_OR_UPDATES = false`).
 */
export function dshDoctorAppendixLines(
  checkTablePath: string,
  installCommand: string,
): readonly string[] {
  const table = readFileSync(checkTablePath, "utf8");
  const rows = [...table.matchAll(
    /^\| (\d+) \| `(host\.[a-z-]+)` \| ([^|]+) \|/gm,
  )].map((m) => ({ order: Number(m[1]), id: m[2], observation: m[3].trim() }));
  if (rows.length !== 6) {
    throw new Error(
      `the check table of contracts/doctor-host-checks.md holds ${rows.length} rows, not 6`,
    );
  }
  return [
    "",
    "## dsh host checks (this package's doctor)",
    "",
    "Relay `specstride doctor` first, through the shim: the CLI's own doctor. Read its",
    "structured output through `--json` only, and relay every finding it prints, one line each.",
    "",
    `Then run this package's own doctor, \`specstride-host-dsh doctor\`, and relay each of its`,
    "findings in the doctor's line grammar, `<severity> <check> — <fix>`. It installs and",
    "updates nothing; a missing CLI is the one launch-blocking finding.",
    "",
    ...rows.map((row) => `- \`${row.id}\` — ${row.observation}`),
    `- No CLI reachable: print \`${installCommand}\` and never run it.`,
    "",
  ];
}

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
