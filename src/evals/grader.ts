/**
 * The session-log grader (T029, PT-120-023, F120-FR-023; DP-002;
 * contracts/eval-driver.md "Grading"). It grades ONE case from the JSONL
 * session log ONLY — nothing else a run said or did reaches the verdict:
 *
 *   matched      a `tool/call` of tool `skill` names the expected skill, OR a
 *                `<skill_content name="<expected>">` of it is injected. A
 *                typed `/name` load injects the same content as a menu pick
 *                (R4: one injection path for every gesture), so it grades
 *                through the same content-injection class.
 *   not matched  otherwise — a `skill` call naming the confusable sibling,
 *                no skill event at all, a bare `skill` tool result with no
 *                event before it.
 *   not scored   decided ONLY by the kit's `howARunEnded` — the exit code is
 *                one of the kit `INTERRUPTED_EXIT_CODES` {130, 143} or the
 *                run carries the kit `USAGE_LIMIT_MARKER`. No local pattern.
 *   unverified   the log path does not resolve under the hermetic
 *                `DSH_HOME` (HF-08) — REPORTED, never counted as matched
 *                (constitution XVII).
 *
 * The baseline (the same case with an empty skill root) is informational and
 * is never a verdict: `baselineOf` below says so and returns no verdict.
 *
 * No model call anywhere; the grader reads recorded behaviour only.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { howARunEnded } from "@specstride/host-kit/evals";

/** The verdict strings of the driver contract, verbatim. */
export type GraderVerdict = "matched" | "not matched" | "not scored" | "unverified";

/** One case to grade: the expected logical id, the run's ending, its DSH_HOME. */
export type GraderCase = {
  /** The expected skill logical id, or null where no skill of this host may fire. */
  readonly expected: string | null;
  /** The exit code the run ended with, where there was one. */
  readonly exitCode: number | null;
  /** The marker the run carries (the kit `USAGE_LIMIT_MARKER`, where it does). */
  readonly marker?: string;
  /** The hermetic `DSH_HOME` of the case — the log is resolved from it (HF-08). */
  readonly dshHome: string;
};

/**
 * The session-log path of a case, resolved from the hermetic `DSH_HOME` per
 * the host-facts row HF-08 (`dsh-session-persistence-jsonl`). The subpath
 * under `DSH_HOME` is stated HERE and nowhere else, so a pin change is one
 * edit backed by the host-facts row.
 */
export function sessionLogPathOf(dshHome: string): string {
  return join(dshHome, "sessions", "session.jsonl");
}

/** One skill event the grader reads out of a session log. */
export type SkillEvent =
  | { readonly class: "tool-call"; readonly name: string }
  | { readonly class: "content-injection"; readonly name: string };

/**
 * Reads the skill events of a session log's text: every `tool/call` whose
 * tool is `skill` (with its `name`), and every `<skill_content name="…">`
 * injection. The injection is scanned in the RAW line text, so it is found
 * wherever the log embeds it — the content block is a string in the line.
 */
export function skillEventsOf(logText: string): readonly SkillEvent[] {
  const events: SkillEvent[] = [];
  for (const line of logText.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const call = jsonSkillCallOf(trimmed);
    if (call !== null) events.push({ class: "tool-call", name: call });
    for (const name of injectedNamesOf(trimmed)) {
      events.push({ class: "content-injection", name });
    }
  }
  return events;
}

/** The `name` of a `tool/call` of tool `skill` on one JSONL line, or null. */
function jsonSkillCallOf(line: string): string | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as { type?: unknown; tool?: unknown; input?: unknown };
  if (record.type !== "tool/call" || record.tool !== "skill") return null;
  if (typeof record.input !== "object" || record.input === null) return null;
  const name = (record.input as { name?: unknown }).name;
  return typeof name === "string" ? name : null;
}

/** Every `<skill_content name="…">` name carried in one raw line. */
function injectedNamesOf(line: string): readonly string[] {
  const names: string[] = [];
  const pattern = /<skill_content\s+name=\\?"([^"\\]+)\\?"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) names.push(match[1]!);
  return names;
}

/**
 * The verdict of one case, graded from the session log only. The order is
 * the contract's: an unresolvable log path is `unverified` FIRST (it is
 * reported and never counted as matched, constitution XVII); then the
 * not-scored endings are decided ONLY by the kit `howARunEnded`; only then
 * is the load matched against the log's skill events.
 */
export function gradeFromSessionLog(graderCase: GraderCase): GraderVerdict {
  const logPath = sessionLogPathOf(graderCase.dshHome);
  if (!existsSync(logPath)) return "unverified";
  let logText: string;
  try {
    logText = readFileSync(logPath, "utf8");
  } catch {
    return "unverified";
  }
  const ended = howARunEnded(graderCase.exitCode, graderCase.marker);
  if (ended !== "scored") return "not scored";
  const events = skillEventsOf(logText);
  if (graderCase.expected === null) {
    return events.length === 0 ? "matched" : "not matched";
  }
  const loaded = events.some((event) => event.name === graderCase.expected);
  return loaded ? "matched" : "not matched";
}

/**
 * The baseline of a case — the same case with an empty skill root. It
 * cannot distinguish a load from a coincidence, so it is INFORMATIONAL and
 * never a verdict: the verdict field is always null and never enters a
 * score, a gate or a report line that reads like one.
 */
export function baselineOf(graderCase: GraderCase): {
  readonly informational: true;
  readonly verdict: null;
  readonly note: string;
} {
  void graderCase;
  return {
    informational: true,
    verdict: null,
    note:
      "baseline: the same case with an empty skill root is informational only — " +
      "it is never a verdict (contracts/eval-driver.md, Baseline)",
  };
}
