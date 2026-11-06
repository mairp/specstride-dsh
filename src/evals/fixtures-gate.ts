/**
 * The build's grader pass over `evals/fixtures/` (T035, F120-FR-025; the
 * grader is T029's, `src/evals/grader.ts` — run here, never reimplemented).
 *
 * The build calls no model: each recorded JSONL fixture is copied into a
 * temp hermetic `DSH_HOME` and graded from the session log only, against the
 * verdict its filename declares (`matched`, `not matched`, `not scored`).
 * A verdict that disagrees with the declared one fails the build.
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { USAGE_LIMIT_MARKER } from "@specstride/host-kit/evals";
import { gradeFromSessionLog, type GraderCase } from "./grader.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURES_DIR = join(ROOT, "evals", "fixtures");

type Expectation = {
  readonly expected: string;
  readonly verdict: string;
  readonly exitCode?: number;
  readonly marker?: string;
};

/**
 * The expectation each recorded fixture carries, keyed by file name. The
 * expected skill is the one the fixture itself names; the `not matched`
 * confusable case expects the sibling (`specstride-run`), which the log
 * does not load.
 */
export const FIXTURE_EXPECTATIONS: Readonly<Record<string, Expectation>> = Object.freeze({
  "tool-call-matched.jsonl": { expected: "specstride-run", verdict: "matched" },
  "content-injection-matched.jsonl": { expected: "specstride-reverse", verdict: "matched" },
  "confusable-sibling-not-matched.jsonl": {
    expected: "specstride-run",
    verdict: "not matched",
  },
  "no-skill-event-not-matched.jsonl": { expected: "specstride-run", verdict: "not matched" },
  "skill-result-without-call-not-matched.jsonl": {
    expected: "specstride-run",
    verdict: "not matched",
  },
  "interrupted-exit-130-not-scored.jsonl": {
    expected: "specstride-run",
    verdict: "not scored",
    exitCode: 130,
  },
  "interrupted-exit-143-not-scored.jsonl": {
    expected: "specstride-run",
    verdict: "not scored",
    exitCode: 143,
  },
  "usage-limit-not-scored.jsonl": {
    expected: "specstride-run",
    verdict: "not scored",
    marker: USAGE_LIMIT_MARKER,
  },
});

/** The fixture name each expectation must have — a fixture with no expectation fails. */
export function unrecordedFixtures(): readonly string[] {
  return readdirSync(FIXTURES_DIR).filter(
    (name) => name.endsWith(".jsonl") && !(name in FIXTURE_EXPECTATIONS),
  );
}

/** Grades one fixture under its own temp hermetic DSH_HOME. */
export function gradeOneFixture(fixture: string): string {
  const expectation = FIXTURE_EXPECTATIONS[fixture];
  if (expectation === undefined) {
    throw new Error(`no recorded expectation for evals/fixtures/${fixture}`);
  }
  const base = mkdtempSync(join(tmpdir(), "specstride-dsh-build-grader-"));
  try {
    const dshHome = join(base, "dsh-home");
    mkdirSync(join(dshHome, "sessions"), { recursive: true });
    copyFileSync(join(FIXTURES_DIR, fixture), join(dshHome, "sessions", "session.jsonl"));
    const graderCase: GraderCase = {
      expected: expectation.expected,
      exitCode: expectation.exitCode ?? 0,
      ...(expectation.marker !== undefined ? { marker: expectation.marker } : {}),
      dshHome,
    };
    return gradeFromSessionLog(graderCase);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

/**
 * The build's grader pass: every fixture graded, every verdict held against
 * its recorded expectation, and no fixture left unrecorded. Returns the
 * report lines; throws naming the fixture on any disagreement.
 */
export function gradeFixturesForBuild(): readonly string[] {
  const lines: string[] = [];
  const unrecorded = unrecordedFixtures();
  if (unrecorded.length > 0) {
    throw new Error(
      `evals/fixtures carries fixture(s) with no recorded expectation: ${unrecorded.join(", ")}`,
    );
  }
  for (const fixture of Object.keys(FIXTURE_EXPECTATIONS)) {
    const verdict = gradeOneFixture(fixture);
    const expectation = FIXTURE_EXPECTATIONS[fixture]!;
    if (verdict !== expectation.verdict) {
      throw new Error(
        `evals/fixtures/${fixture} grades "${verdict}" but is recorded "${expectation.verdict}"`,
      );
    }
    lines.push(`fixture ${fixture}: ${verdict}`);
  }
  void readFileSync; // (kept off the hot path; the grader reads the logs)
  return lines;
}
