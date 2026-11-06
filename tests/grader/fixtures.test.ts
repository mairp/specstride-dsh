/**
 * T029 — the session-log grader against the recorded fixtures of
 * `evals/fixtures/` (PT-120-023, F120-FR-023; DP-002;
 * contracts/eval-driver.md "Grading"). Zero model calls: every case grades
 * a recorded JSONL session log under a hermetic `DSH_HOME`.
 *
 * Covered classes: a `tool/call` of tool `skill` naming the expected skill
 * (matched), a `<skill_content name="…">` injection — the class a typed
 * `/name` load grades through (matched), a `skill` call naming the
 * confusable sibling (not matched), no skill event (not matched), a bare
 * `skill` tool result with no event before it (not matched), exit 130 and
 * exit 143 (not scored), the usage-limit ending (not scored), and an
 * unresolvable log path (unverified — never counted as matched). The
 * baseline is informational and never a verdict.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  INTERRUPTED_EXIT_CODES,
  USAGE_LIMIT_MARKER,
  howARunEnded,
} from "@specstride/host-kit/evals";
import {
  gradeFromSessionLog,
  sessionLogPathOf,
  skillEventsOf,
  baselineOf,
  type GraderCase,
} from "../../src/evals/grader.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURES = join(ROOT, "evals", "fixtures");

/** Grades one fixture file as a case run under its own hermetic DSH_HOME. */
function gradeFixture(
  fixture: string,
  extra: { expected: string | null; exitCode?: number | null; marker?: string },
): string {
  const base = mkdtempSync(join(tmpdir(), "specstride-dsh-grader-"));
  try {
    const dshHome = join(base, "dsh-home");
    mkdirSync(join(dshHome, "sessions"), { recursive: true });
    copyFileSync(join(FIXTURES, fixture), sessionLogPathOf(dshHome));
    const graderCase: GraderCase = {
      expected: extra.expected,
      exitCode: extra.exitCode ?? 0,
      ...(extra.marker !== undefined ? { marker: extra.marker } : {}),
      dshHome,
    };
    return gradeFromSessionLog(graderCase);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

test("a tool/call of tool skill naming the expected skill grades matched", () => {
  assert.equal(
    gradeFixture("tool-call-matched.jsonl", { expected: "specstride-run" }),
    "matched",
  );
});

test("a <skill_content name=…> injection grades matched — the class a typed /name load grades through", () => {
  assert.equal(
    gradeFixture("content-injection-matched.jsonl", { expected: "specstride-reverse" }),
    "matched",
  );
});

test("a skill call naming the confusable sibling grades not matched", () => {
  assert.equal(
    gradeFixture("confusable-sibling-not-matched.jsonl", { expected: "specstride-run" }),
    "not matched",
  );
});

test("no skill event grades not matched", () => {
  assert.equal(
    gradeFixture("no-skill-event-not-matched.jsonl", { expected: "specstride-run" }),
    "not matched",
  );
});

test("a bare skill tool result with no skill event before it grades not matched", () => {
  assert.equal(
    gradeFixture("skill-result-without-call-not-matched.jsonl", { expected: "specstride-run" }),
    "not matched",
  );
});

test("exit 130 grades not scored — and a matching load cannot rescue it", () => {
  assert.equal(INTERRUPTED_EXIT_CODES.includes(130), true);
  assert.equal(howARunEnded(130), "interrupted");
  assert.equal(
    gradeFixture("interrupted-exit-130-not-scored.jsonl", { expected: "specstride-run", exitCode: 130 }),
    "not scored",
  );
});

test("exit 143 grades not scored", () => {
  assert.equal(INTERRUPTED_EXIT_CODES.includes(143), true);
  assert.equal(
    gradeFixture("interrupted-exit-143-not-scored.jsonl", { expected: "specstride-reverse", exitCode: 143 }),
    "not scored",
  );
});

test("the usage-limit ending grades not scored, decided by the kit marker only", () => {
  assert.equal(USAGE_LIMIT_MARKER, "usage-limit");
  assert.equal(howARunEnded(0, USAGE_LIMIT_MARKER), "usage-limit");
  assert.equal(
    gradeFixture("usage-limit-not-scored.jsonl", {
      expected: "specstride-run",
      marker: USAGE_LIMIT_MARKER,
    }),
    "not scored",
  );
});

test("an exit outside the kit interrupt set is scored — no local pattern widens it", () => {
  assert.equal(howARunEnded(129), "scored");
  assert.equal(howARunEnded(1), "scored");
  assert.equal(
    gradeFixture("tool-call-matched.jsonl", { expected: "specstride-run", exitCode: 1 }),
    "matched",
  );
});

test("an unresolvable log path is unverified — reported, never counted as matched", () => {
  const verdict = gradeFromSessionLog({
    expected: "specstride-run",
    exitCode: 0,
    dshHome: mkdtempSync(join(tmpdir(), "specstride-dsh-empty-")),
  });
  assert.equal(verdict, "unverified");
  assert.notEqual(verdict, "matched");
});

test("the baseline is informational and never a verdict", () => {
  const baseline = baselineOf({ expected: "specstride-run", exitCode: 0, dshHome: "/unused" });
  assert.equal(baseline.informational, true);
  assert.equal(baseline.verdict, null);
});

test("the event reader sees the tool call and the injection, and nothing else", () => {
  const events = skillEventsOf(
    '{"type":"tool/call","tool":"skill","input":{"name":"specstride-run"}}\n' +
      '{"type":"tool/call","tool":"bash","input":{"command":"ls"}}\n' +
      'plain text <skill_content name="specstride-reverse"> body </skill_content>\n',
  );
  assert.deepEqual(
    events.map((event) => `${event.class}:${event.name}`).sort(),
    ["content-injection:specstride-reverse", "tool-call:specstride-run"],
  );
});
