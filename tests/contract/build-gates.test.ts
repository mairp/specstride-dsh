/**
 * T034/T035 — the build gates of `scripts/build.ts` (SC-002, F120-FR-009,
 * F120-FR-012, F120-FR-025): line attribution, reference closure, the
 * description measures, the once-only protocol range, the zero engine copies
 * and the no-model per-change guard (`staticCheckOf` with this host's
 * `StaticCheckRules` over the suite files, `SuiteRunnerInBuildError` for a
 * suite runner in the build, and the fixture grading).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WHITELISTED_GENERATED_BLOCKS,
  unattributedLines,
  referenceClosureFindings,
  descriptionMeasureViolations,
  protocolRangeRestatements,
  PROTOCOL_RANGE_DECLARATION,
  sha256Of,
  hashTree,
  copyMatches,
} from "../../src/gates.ts";
import {
  staticFindings,
  dshStaticCheck,
  buildJobsOf,
  loadSuiteFiles,
  loadGradersFile,
  DSH_STATIC_RULES,
} from "../../src/evals/driver.ts";
import { kanbanNoModelFindings } from "../../src/gates.ts";
import { staticCheckCallsAModel, SuiteRunnerInBuildError } from "@specstride/host-kit/evals";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("SC-002 line attribution: every rendered line of the run skill attributes to a declared origin", () => {
  const composed = readFileSync(join(ROOT, "skills", "specstride-run", "SKILL.md"), "utf8");
  const findings = unattributedLines(composed, [
    composed, // the kit body (the composed artifact itself)
    "### dsh runtime notes\n\n- dsh exists in the environment as a skill entry point.",
  ]);
  assert.deepEqual(findings, [], "unattributed lines in the composed artifact");
  assert.ok(WHITELISTED_GENERATED_BLOCKS.length >= 3);
});

test("F120-FR-009 reference closure: the helpers fire on the four closed kinds of reference", () => {
  for (const bad of [
    "read src/port.ts to see the contract",
    "the state lives under ~/.local/state/specstride/",
    "check the log at ~/.specstride/sessions/session.jsonl",
    "then run node_modules/specstride/bin.js",
  ]) {
    assert.ok(referenceClosureFindings(bad, "probe").length >= 1, bad);
  }
  assert.deepEqual(referenceClosureFindings("derive the contract, relay verbatim", "probe"), []);
});

test("the two model-invocable descriptions measure within the caps (≤500 each, ≤1000 together)", () => {
  assert.deepEqual(descriptionMeasureViolations({ run: "a".repeat(499), reverse: "b".repeat(499) }), []);
  assert.equal(
    descriptionMeasureViolations({ run: "a".repeat(501), reverse: "b".repeat(499) }).length,
    1,
  );
  assert.equal(
    descriptionMeasureViolations({
      run: "a".repeat(500),
      reverse: "b".repeat(500),
      doctor: "c",
    }).length,
    1,
  );
});

test("F120-FR-012: the protocol range is declared once, in the manifest — nowhere in src/ or scripts/", () => {
  const files: { path: string; text: string }[] = [];
  for (const tree of ["src", "scripts"]) {
    for (const name of readdirSync(join(ROOT, tree), { recursive: true })) {
      const path = join(ROOT, tree, String(name));
      if (statSync(path).isFile() && path.endsWith(".ts")) {
        files.push({ path, text: readFileSync(path, "utf8") });
      }
    }
  }
  // The gate itself names the DECLARATION pattern (a check, not a declaration).
  const restatements = protocolRangeRestatements(
    files.filter((f) => !f.text.includes("PROTOCOL_RANGE_DECLARATION")),
  );
  assert.deepEqual(restatements, []);
  assert.match(String(PROTOCOL_RANGE_DECLARATION), /SUPPORTED_PROTOCOL_/);
});

test("the shipped tree holds no copy of any engine file (4 pinned tarballs + core checkout)", () => {
  // A tiny engine tree with one distinctive file; the shipped tree copies it → match fires.
  const engine = mkdtempSync(join(tmpdir(), "engine-"));
  const shipped = mkdtempSync(join(tmpdir(), "shipped-"));
  mkdirSync(join(engine, "lib"));
  writeFileSync(join(engine, "lib", "unique-engine-file.ts"), "export const UNIQUE = 1;\n");
  mkdirSync(join(shipped, "skills", "x"), { recursive: true });
  writeFileSync(join(shipped, "skills", "x", "SKILL.md"), "---\ntitle: x\n---\nbody\n");
  try {
    assert.deepEqual(copyMatches(hashTree(shipped), hashTree(engine)), []);
    writeFileSync(
      join(shipped, "skills", "x", "unique-engine-file.ts"),
      "export const UNIQUE = 1;\n",
    );
    const matches = copyMatches(hashTree(shipped), hashTree(engine));
    assert.equal(matches.length, 1);
    assert.match(matches[0]!.shipped, /unique-engine-file\.ts$/);
    assert.match(matches[0]!.engine, /unique-engine-file\.ts$/);
  } finally {
    rmSync(engine, { recursive: true, force: true });
    rmSync(shipped, { recursive: true, force: true });
  }
  assert.equal(
    sha256Of("x"),
    "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881",
  );
});

test("T035 no-model guard: staticFindings over the real manifest scripts is all-ok and the build calls no model", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const findings = staticFindings(manifest.scripts);
  assert.ok(findings.length >= 1);
  for (const finding of findings) {
    assert.equal(finding.ok, true, `check ${finding.check} failed: ${finding.detail}`);
  }
  assert.equal(staticCheckCallsAModel(), false);
});

test("T050 kanban no-model guard: the plugin tree scans clean and the scan fires on a planted finding (F121-SC-005)", () => {
  // The real plugin tree: src/, scripts/ and tests/ hold no provider SDK
  // import, no provider host name, no API-key variable read.
  const real = kanbanNoModelFindings(join(ROOT, "packages", "dsh-kanban"));
  assert.deepEqual(real, [], JSON.stringify(real));
  // The scan fires, per pattern family, on a planted tree.
  const scratch = mkdtempSync(join(tmpdir(), "kanban-nomodel-"));
  const src = join(scratch, "src");
  mkdirSync(src, { recursive: true });
  const cases: [string, RegExp][] = [
    ['import x from "@anthropic-ai/sdk";', /provider SDK import/],
    ["fetch(`https://api.openai.com/v1/x`)", /provider host name/],
    ["const key = process.env.OPENAI_API_KEY;", /API key variable read/],
  ];
  try {
    cases.forEach(([line], index) => {
      const file = join(src, `case${index}.ts`);
      writeFileSync(file, line, "utf8");
      const findings = kanbanNoModelFindings(scratch);
      assert.equal(findings.length, 1, line);
      assert.match(findings[0]!.detail, cases[index]![1]);
      assert.match(findings[0]!.path, /case\d\.ts$/);
      rmSync(file);
    });
    assert.deepEqual(kanbanNoModelFindings(scratch), []);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("T035: a suite runner in a build job raises the kit SuiteRunnerInBuildError", () => {
  assert.throws(
    () => dshStaticCheck.assertNoJobStartsTheSuiteRunner([{ declaredIn: "build", command: "node trigger-suite runner.ts" }]),
    SuiteRunnerInBuildError,
  );
  // And the real manifest's jobs raise nothing.
  const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  dshStaticCheck.assertNoJobStartsTheSuiteRunner(buildJobsOf(manifest.scripts));
});

test("T035: the suite files pass the kit staticCheckOf with the port's StaticCheckRules (6+6, run-vs-reverse, requirement ids)", () => {
  const findings = dshStaticCheck.checkSuiteFiles(
    loadSuiteFiles(),
    loadGradersFile() as Parameters<typeof dshStaticCheck.checkGraders>[0],
  );
  assert.ok(findings.length >= 1);
  for (const finding of findings) {
    assert.equal(finding.ok, true, `static check failed: ${finding.detail}`);
  }
  // The rules the checks hold: 6 positive + 6 negative cases per skill, the pair, markers, ids.
  assert.equal(DSH_STATIC_RULES.positiveCasesPerSkill, 6);
  assert.equal(DSH_STATIC_RULES.negativeCasesPerSkill, 6);
  assert.equal(DSH_STATIC_RULES.confusablePair, "run-vs-reverse");
  assert.equal(DSH_STATIC_RULES.requirementIds.suiteCases, "F120-FR-024");
  assert.equal(DSH_STATIC_RULES.requirementIds.buildNoSuiteRunner, "F120-FR-025");
  assert.ok(DSH_STATIC_RULES.suiteRunnerMarkers.length >= 1);
});
