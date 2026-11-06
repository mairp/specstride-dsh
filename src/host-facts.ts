/**
 * The host-facts table (T004, F120-FR-029; data-model.md §7; research.md
 * R13). One row per dsh fact this package relies on, with its source, its
 * verification date (`"unverified"` where the fact rests on documentation or
 * is unknown on the pinned build), the dsh version pin, and, for an
 * `unverified` row, the check that would settle it (Principle XVII: an
 * unverified fact is reported, never assumed).
 *
 * Seeded from `docs/ecosystem/research/R4-dsh-host.md` (verified-local
 * 2026-09-29 against dsh 0.1.0-rc.8; re-checked 2026-11-06 — `dsh --version`
 * still prints 0.1.0-rc.8) and `research/dsh-plugin-facts.md` (2026-10-04).
 * The live probe of F120-FR-030 writes its results back into the rows it
 * settles and bumps their `verifiedOn`.
 */

/** The dsh release every row is pinned to. */
export const DSH_VERSION_PIN = "0.1.0-rc.8";

/**
 * The recorded dsh-version range `host.dsh-version` reads (F120-FR-016,
 * F120-FR-029): the tested release inside it, past it a finding that stops
 * nothing.
 */
export const DSH_VERSION_RANGE = ">=0.1.0-rc.8 <0.1.0";

export type HostFactRow = {
  /** The row id, `HF-…`. */
  readonly id: string;
  /** The fact, in one sentence. */
  readonly fact: string;
  /** Where the fact was read from. */
  readonly source: string;
  /** The verification date, or `"unverified"`. */
  readonly verifiedOn: string;
  /** The dsh version the fact is pinned to. */
  readonly pin: string;
  /** For an `unverified` row: the check that would settle it; else `null`. */
  readonly settlingCheck: string | null;
};

const R4 = "docs/ecosystem/research/R4-dsh-host.md (verified-local 2026-09-29, re-checked 2026-11-06)";
const FACTS = "research/dsh-plugin-facts.md (2026-10-04)";

export const dshHostFacts: readonly HostFactRow[] = Object.freeze([
  {
    id: "HF-01",
    fact:
      "dsh scans five skill roots in rank order: <projectRoot>/.dsh/skills (rank 100), <projectRoot>/.agents/skills (rank 200), customSkillDirs (rank 300), $DSH_HOME/skills (rank 400), ~/.agents/skills (rank 500); a higher rank (lower number) shadows a lower one.",
    source: `${R4}, F4/F5`,
    verifiedOn: "2026-11-06",
    pin: DSH_VERSION_PIN,
    settlingCheck: null,
  },
  {
    id: "HF-02",
    fact:
      "The scanner reads only <name>/SKILL.md and <name>.md per root; the frontmatter `name` must be kebab-case and is the skill's whole name — dsh has no colon namespace.",
    source: `${R4}, F2/F5`,
    verifiedOn: "2026-11-06",
    pin: DSH_VERSION_PIN,
    settlingCheck: null,
  },
  {
    id: "HF-03",
    fact:
      "The skill catalog caps a description at 500 characters (longer is cut) and is resident on every turn — the two model-invocable descriptions together stay within 1,000 characters (F120-FR-026).",
    source: `${R4}, F6`,
    verifiedOn: "2026-11-06",
    pin: DSH_VERSION_PIN,
    settlingCheck: null,
  },
  {
    id: "HF-04",
    fact:
      "Profiles select the surface: `dsh --profile headless \"<prompt>\"` runs one task with no follow-up and no approver; an approval-needing step fails closed. The web profile is the interactive surface.",
    source: `${R4}, F9`,
    verifiedOn: "2026-11-06",
    pin: DSH_VERSION_PIN,
    settlingCheck: null,
  },
  {
    id: "HF-05",
    fact:
      "DSH_PERMISSION_MODE sets the sandbox mode; unset it defaults to `workspace-write` with `ask` — the state home outside the workspace is then not writable, which the doctor checks.",
    source: `${R4}, F11 (verified fact of rc.8)`,
    verifiedOn: "2026-11-06",
    pin: DSH_VERSION_PIN,
    settlingCheck: null,
  },
  {
    id: "HF-06",
    fact:
      "dsh jobs (bash run_in_background) are owned by the calling session and are cancelled when it is disposed — a run must never rely on one for survival.",
    source: `${R4}, F10, Q2 (\"Jobs are owned by the calling session id\")`,
    verifiedOn: "2026-11-06",
    pin: DSH_VERSION_PIN,
    settlingCheck: null,
  },
  {
    id: "HF-07",
    fact:
      "dsh offers no hook a consumer can configure: alerts come from the engine's own status and digest lines, never a host hook.",
    source: `${R4}, F14; decision-log E4 (DP-003)`,
    verifiedOn: "2026-11-06",
    pin: DSH_VERSION_PIN,
    settlingCheck: null,
  },
  {
    id: "HF-08",
    fact:
      "The session log is JSONL (dsh-session-persistence-jsonl) and its exact path is resolved from DSH_HOME; the eval driver resolves it from the hermetic DSH_HOME of the case.",
    source: `${FACTS}, §1 (profiles at $DSH_HOME) and ${R4} F9`,
    verifiedOn: "2026-11-06",
    pin: DSH_VERSION_PIN,
    settlingCheck: null,
  },
  {
    id: "HF-09",
    fact:
      "Detached survival past session end: a run started detached from a dsh session outlives that session — observed 2026-11-06 (a run started through the skill specstride-run's launch step (the shim specstride-dsh, foreground) outlived the dsh session — alive from a fresh shell after the session exited, reparented to PID 1).",
    source: `${R4}, F13 status (documentation); live probe 2026-11-06, evals/probe-results/2026-11-06-hf09-skill-launch-step.txt (rerun through the skill's launch step; also 2026-11-06-hf09-hf10-detached-survival.txt)`,
    verifiedOn: "2026-11-06",
    pin: DSH_VERSION_PIN,
    settlingCheck: null,
  },
  {
    id: "HF-10",
    fact:
      "Teardown and the process group: dsh's session teardown does not kill the whole process group — the detached child survives the session's end in its own process group (own PGID and SID, reparented to PID 1; observed 2026-11-06).",
    source: `${R4}, F13 status (documentation); live probe 2026-11-06, evals/probe-results/2026-11-06-hf09-skill-launch-step.txt (rerun through the skill's launch step; also 2026-11-06-hf09-hf10-detached-survival.txt)`,
    verifiedOn: "2026-11-06",
    pin: DSH_VERSION_PIN,
    settlingCheck: null,
  },
  {
    id: "HF-11",
    fact:
      "Sandbox writable roots: on the probe host (root, Linux) a dsh session wrote outside the workspace — into the state home — under BOTH workspace-write (headless, no approver) and danger-full-access; no sandbox denial was observed, so a writable root that includes the state home is in force on the installed rc.8 (observed 2026-11-06).",
    source: `${R4}, F17 status (documentation); live probe 2026-11-06, evals/probe-results/2026-11-06-hf11-hf12-sandbox.txt`,
    verifiedOn: "2026-11-06",
    pin: DSH_VERSION_PIN,
    settlingCheck: null,
  },
  {
    id: "HF-12",
    fact:
      "A detached child escapes the session's sandbox rather than inheriting it: from a workspace-write session the detached child's write outside the workspace landed (observed 2026-11-06).",
    source: `${R4}, F13/F17 status (documentation); live probe 2026-11-06, evals/probe-results/2026-11-06-hf11-hf12-sandbox.txt`,
    verifiedOn: "2026-11-06",
    pin: DSH_VERSION_PIN,
    settlingCheck: null,
  },
  {
    id: "HF-13",
    fact:
      "Command-roster visibility: whether a dsh client can list the command roster (to detect a collision between a skill name and a dsh host command).",
    source: `${R4}, Q5 (unverified on rc.8)`,
    verifiedOn: "unverified",
    pin: DSH_VERSION_PIN,
    settlingCheck:
      "read of the installed rc.8: attempt a roster listing from a client session; until settled the doctor prints the fact as unverified and no check claims a pass it cannot ground",
  },
  {
    id: "HF-14",
    fact:
      "A model-free headless task: dsh rc.8 does not allow one — `dsh --profile headless` invokes a model even for a no-tool task (usage inputTokens 665, outputTokens 4 observed) and refuses to boot a task without a model credential (MISSING_CREDENTIAL); the probe is therefore a paid task under F120-FR-024 (live-probe-dsh).",
    source: `${R4}, F9 open question 5; live probe 2026-11-06, evals/probe-results/2026-11-06-hf14-model-free-headless.txt`,
    verifiedOn: "2026-11-06",
    pin: DSH_VERSION_PIN,
    settlingCheck: null,
  },
  {
    id: "HF-15",
    fact:
      "The dsh tool-restriction flag: rc.8 shows none, so the tool restriction of F120-FR-024 (no case of the trigger suite can launch a run) is enforced environmentally — a stub `specstride` whose `launch` refuses, on the case PATH.",
    source: `specs/120-host-dsh/contracts/eval-driver.md; ${R4} (rc.8 shows no tool-restriction flag)`,
    verifiedOn: "unverified",
    pin: DSH_VERSION_PIN,
    settlingCheck:
      "read of the installed rc.8 (and any later build): search the command surface for a tool-restriction flag; T030 records the finding and the eval driver keeps the environmental stub either way",
  },
]);

/** The `unverified` rows, in table order — the ones a settling check awaits. */
export function unverifiedDshHostFacts(): readonly HostFactRow[] {
  return dshHostFacts.filter((row) => row.verifiedOn === "unverified");
}

/** The host-facts row with an id, or `undefined`. */
export function dshHostFactOf(id: string): HostFactRow | undefined {
  return dshHostFacts.find((row) => row.id === id);
}

/** The pin of the row with an id; every row carries one. */
export function dshHostFactPin(id: string): string {
  const row = dshHostFactOf(id);
  if (row === undefined) throw new Error(`unknown host-facts row: ${id}`);
  return row.pin;
}
