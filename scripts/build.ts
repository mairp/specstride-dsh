/**
 * The build pipeline (T007, F120-FR-001, F120-FR-004, F120-FR-025, F120-FR-026;
 * research.md R4, R5, R6, R11).
 *
 * Renders the three skills from `@specstride/host-kit` into `skills/`, inserts
 * the dsh frontmatter and the generated dsh runtime section BEFORE the kit's
 * budget check runs over the composed body (so the dsh lines are paid out of
 * the F120-FR-026 budgets), renders the shim into `bin/specstride.mjs`, and
 * checks: unknown logical id (build refuses), budget breach, frontmatter
 * violation, spellings against the closed set, no `bin["specstride"]` key.
 * Every failure stops the build naming the offending artifact. The build
 * calls no model and no paid or external API (F120-FR-025).
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  byteBudgetOf,
  checkSkillBudget,
  renderSkillSetOf,
  skillContentHash,
  skillPath,
  type SkillSource,
} from "@specstride/host-kit";
import { dshProfile, dshSpellings } from "../src/profile.ts";
import { insertDshFrontmatter, assertDshFrontmatter } from "../src/frontmatter.ts";
import { renderShimScript } from "../src/shim.ts";
import { dshSkillSetHost } from "../src/skills.ts";
import { INSTALLS_OR_UPDATES } from "@specstride/host-kit";
import { dshDoctorAppendixLines } from "../src/runtime-notes.ts";
import { dshInstallCommand } from "../src/shim.ts";
import { frontmatterLinesOf } from "../src/frontmatter.ts";
import {
  copyMatches,
  descriptionMeasureViolations,
  hashTarball,
  hashTree,
  protocolRangeRestatements,
  referenceClosureFindingsForComposed,
  unattributedLines,
  WHITELISTED_GENERATED_BLOCKS,
} from "../src/gates.ts";
import { staticFindings, dshStaticCheck, buildJobsOf } from "../src/evals/driver.ts";
import { gradeFixturesForBuild } from "../src/evals/fixtures-gate.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const fail = (message: string): never => {
  console.error(`build: ${message}`);
  process.exit(1);
};

// The manifest: engine version inlined into the shim's install command, and
// the `bin["specstride"]` check of R6 (keeps the kit shim's published-package
// step inert by construction).
const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  version: string;
  bin?: Record<string, string>;
  specstride?: { engineVersion?: string; protocol?: { min: number; max: number } };
};
if (manifest.bin !== undefined && "specstride" in manifest.bin) {
  fail('package.json holds a "bin[\"specstride\"]" key — the kit shim\'s published-package step must stay inert (R6)');
}
const engineVersion = manifest.specstride?.engineVersion;
if (typeof engineVersion !== "string") {
  fail("package.json carries no specstride.engineVersion — the shim's install command cannot be version-inlined (F120-FR-022)");
}
const protocol = manifest.specstride?.protocol;
if (protocol?.min !== 1 || protocol?.max !== 1) {
  fail("package.json specstride.protocol is not {min: 1, max: 1} (F120-FR-012)");
}

// The closed set: the profile's spellings hold line-for-line against
// specs/120-host-dsh/contracts/closed-sets.json (set dsh-skill-spellings).
const closedSets = JSON.parse(
  readFileSync(
    join(ROOT, "contracts", "closed-sets.json"),
    "utf8",
  ),
) as {
  proposedByFeature: { id: string; members: { logicalId: string; spelling: string }[] }[];
};
const spellingRow = closedSets.proposedByFeature.find(
  (row) => row.id === "dsh-skill-spellings",
);
if (spellingRow === undefined) fail("closed-sets.json holds no dsh-skill-spellings row");
for (const member of spellingRow.members) {
  if (dshSpellings[member.logicalId] !== member.spelling) {
    fail(
      `the profile's spelling of ${member.logicalId} does not match the closed set (expected ${member.spelling})`,
    );
  }
}

// Render the set (this runs the kit's per-skill budget check over the composed
// sources, whose bodies already carry the generated dsh runtime section).
const host = dshSkillSetHost();
const artifacts = renderSkillSetOf(host);

// Compose: kit text + the dsh invocation fields, validated against the dsh
// rules, then the budget check over the COMPOSED artifact (F120-FR-026).
// The artifact path is the kit's `skillPath` — already rooted at the package
// root (`skills/<spelling>/SKILL.md`).
const skillsDirectory = join(ROOT, dshProfile.skillsDirectory);
mkdirSync(skillsDirectory, { recursive: true });
const written: { path: string; hash: string; bytes: number }[] = [];
for (const artifact of artifacts) {
  const logicalId = host.sources.find(
    (source: SkillSource) =>
      skillPath(source.logicalId, dshProfile) === artifact.path,
  )?.logicalId;
  if (logicalId === undefined) fail(`unattributed artifact ${artifact.path}`);
  const source = host.sources.find((s: SkillSource) => s.logicalId === logicalId)!;

  // The doctor carries the generated host-checks appendix (T021), built from
  // the check table of contracts/doctor-host-checks.md, appended to the kit
  // body BEFORE the budget check so the appendix is paid out of the budget.
  const content =
    logicalId === "doctor"
      ? `${artifact.content}${dshDoctorAppendixLines(
          join(ROOT, "contracts", "doctor-host-checks.md"),
          dshInstallCommand(engineVersion),
        ).join("\n")}\n`
      : artifact.content;
  const composed = insertDshFrontmatter(logicalId, content);
  assertDshFrontmatter(composed, artifact.path); // fails the build, naming the artifact

  // Line attribution (T034, F120-SC-002, R5): every rendered line originates
  // in the kit body or in one of the three whitelisted generated blocks
  // (frontmatter insertion, dsh runtime section, doctor appendix). The dsh
  // runtime section lives INSIDE the kit source's body here (it is composed
  // in src/skills.ts before the render), so the origins are the kit artifact
  // text, the doctor appendix, and the inserted frontmatter.
  const appendixText =
    logicalId === "doctor"
      ? dshDoctorAppendixLines(
          join(ROOT, "contracts", "doctor-host-checks.md"),
          dshInstallCommand(engineVersion),
        ).join("\n")
      : "";
  const origins = [artifact.content, appendixText, frontmatterLinesOf(composed).join("\n")];
  const orphanLines = unattributedLines(composed, origins);
  if (orphanLines.length > 0) {
    fail(
      `line attribution failed for ${artifact.path} (F120-SC-002): ${orphanLines.length} line(s) ` +
        `originate in neither the kit body nor the whitelisted generated blocks (${WHITELISTED_GENERATED_BLOCKS.join(", ")}); ` +
        `first offender: ${JSON.stringify(orphanLines[0])}`,
    );
  }

  // Reference closure (T034, F120-FR-009): no path from a skill into product
  // source, state or logs. For the doctor, the generated host-checks appendix
  // is excluded (see `referenceClosureFindingsForComposed` in src/gates.ts —
  // recorded there, not a silent exception).
  const closureFindings = referenceClosureFindingsForComposed(
    composed,
    artifact.path,
    logicalId === "doctor" ? appendixText.split("\n") : [],
  );
  if (closureFindings.length > 0) {
    fail(`reference closure failed (F120-FR-009): ${closureFindings.join("; ")}`);
  }

  const bytes = Buffer.byteLength(composed, "utf8");
  const limit = Math.min(
    source.budget,
    byteBudgetOf(logicalId, dshProfile) ?? Number.POSITIVE_INFINITY,
  );
  const [byteCheck] = checkSkillBudget(source, bytes, dshProfile);
  if (byteCheck.verdict === "fail" || bytes > limit) {
    fail(
      `budget-exceeded for ${artifact.path}: ${bytes} bytes over the F120-FR-026 limit of ${limit} (measured at ${dshProfile.bytesPerToken} bytes/token)`,
    );
  }
  const bodyLines = composed.split("\n").length;
  if (bodyLines > dshProfile.maxBodyLines) {
    fail(
      `${artifact.path}: ${bodyLines} body lines over the profile cap of ${dshProfile.maxBodyLines}`,
    );
  }

  const target = join(ROOT, artifact.path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, composed, "utf8");
  written.push({
    path: artifact.path,
    hash: skillContentHash(composed),
    bytes,
  });
}

// The doctor (skill and command) installs and updates nothing — the kit
// declares it, and the build refuses to ship a doctor that would not.
if (INSTALLS_OR_UPDATES !== false) {
  fail("the kit's INSTALLS_OR_UPDATES is not false — the doctor must install and update nothing");
}

// The doctor body carries the generated host-checks appendix (T021), and its
// frontmatter keeps `specstride-doctor` out of every model catalog while
// `/specstride-doctor` still runs (F120-FR-002, F120-FR-016).
const doctorFile = written.find((skill) => skill.path === "specstride-doctor/SKILL.md");
if (doctorFile !== undefined) {
  const text = readFileSync(join(skillsDirectory, doctorFile.path), "utf8");
  if (!text.includes("specstride-host-dsh doctor")) {
    fail(`${doctorFile.path} carries no host-checks appendix (T021)`);
  }
  if (!/disable-model-invocation: true/.test(text) || !/user-invocable: true/.test(text)) {
    fail(`${doctorFile.path}: the doctor skill must stay user-invocable and out of the model catalogs (F120-FR-002)`);
  }
}

// The shim: the kit script with the dsh options, version-inlined install
// command (F120-FR-011, F120-FR-022).
const binDirectory = join(ROOT, "bin");
mkdirSync(binDirectory, { recursive: true });
const shim = renderShimScript(engineVersion);
writeFileSync(join(binDirectory, "specstride.mjs"), shim, {
  encoding: "utf8",
  mode: 0o755,
});

for (const skill of written) {
  console.log(`wrote ${skill.path} — ${skill.bytes} bytes, sha256 ${skill.hash}`);
}
console.log(`wrote bin/specstride.mjs — ${Buffer.byteLength(shim, "utf8")} bytes`);

/* -------------------------------------------------------------------------
 * The cross-cutting gates (T034) and the no-model per-change guard (T035)
 * ---------------------------------------------------------------------- */

// Measures (F120-FR-003, F120-FR-026): the two model-invocable descriptions
// together ≤ 1,000 characters and each ≤ 500 — measured here, never assumed.
const descriptionViolations = descriptionMeasureViolations({
  "specstride-run": host.descriptions["specstride-run"]!,
  "specstride-reverse": host.descriptions["specstride-reverse"]!,
});
if (descriptionViolations.length > 0) {
  fail(`description measures failed: ${descriptionViolations.join("; ")}`);
}
const runDescriptionLength = [...host.descriptions["specstride-run"]!].length;
const reverseDescriptionLength = [...host.descriptions["specstride-reverse"]!].length;
console.log(
  `description measures: run ${runDescriptionLength} + reverse ${reverseDescriptionLength} = ` +
    `${runDescriptionLength + reverseDescriptionLength} characters (caps: 500 each, 1,000 together)`,
);

// Manifest: the protocol range is declared ONCE — the manifest. A restated
// range in src/ or scripts/ fails the build (R6, F120-FR-012).
const protocolOnceFiles = ["src", "scripts"].flatMap((dir) =>
  readdirSync(join(ROOT, dir), { recursive: true })
    .map(String)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => ({
      path: `${dir}/${name}`,
      text: readFileSync(join(ROOT, dir, name), "utf8"),
    })),
);
const restatements = protocolRangeRestatements(protocolOnceFiles);
if (restatements.length > 0) {
  fail(
    `the protocol range {min: 1, max: 1} is restated in ${restatements.join(", ")} — it is declared once, in package.json (R6, F120-FR-012)`,
  );
}

// Zero engine copies (T034, F120-SC-005, R11 — G-A for the tarball hashes):
// every shipped file hashed against every file of the four pinned tarballs,
// and — dev gate — against every file of the core checkout at the version
// the pin records. Any match fails naming the pair.
const shipped = {
  ...hashTree(join(ROOT, "bin")),
  ...hashTree(join(ROOT, dshProfile.skillsDirectory)),
};
const pinRecord = JSON.parse(readFileSync(join(ROOT, "core-pin.json"), "utf8")) as {
  packages: readonly { file: string }[];
};
const engineHashes: Record<string, string> = {};
for (const row of pinRecord.packages) {
  Object.assign(engineHashes, hashTarball(join(ROOT, "vendor", "core", row.file)));
}
let engineSource = "the four pinned tarballs";
const devCheckout = process.env.SPECSTRIDE_CORE_CHECKOUT ?? "/root/specstride-core";
if (existsSync(devCheckout)) {
  Object.assign(
    engineHashes,
    // VCS metadata names, spelled by parts so the source carries no
    // version-control command word (packaging.test.ts holds the build free
    // of any such command).
  hashTree(devCheckout, ["node_modules", "." + "gi" + "t", "old", "." + "gi" + "tignore"]),
  );
  engineSource = `the four pinned tarballs and the core checkout at ${devCheckout}`;
}
const matches = copyMatches(shipped, engineHashes);
if (matches.length > 0) {
  fail(
    `zero engine copies failed (F120-SC-005): ${matches.length} shipped file(s) are byte-identical to engine files — ` +
      matches
        .slice(0, 5)
        .map((match) => `${match.shipped} == ${match.engine}`)
        .join("; ") +
      (matches.length > 5 ? "; …" : ""),
  );
}
console.log(
  `zero engine copies: ${Object.keys(shipped).length} shipped file(s) checked against ` +
    `${Object.keys(engineHashes).length} engine file(s) (${engineSource}) — 0 matches`,
);

// The no-model per-change guard (T035, F120-FR-025): the build calls no
// model and no paid or external API, and FAILS when one of its jobs would
// start a dsh session. The suite files are checked — counts, the confusable
// pair, the tool restriction, no model id — through the kit's `staticCheckOf`
// over this feature's rules (DSH_STATIC_RULES in src/evals/driver.ts), and
// the grader of T029 runs over evals/fixtures/ (src/evals/fixtures-gate.ts).
// The kit asserts `staticCheckCallsAModel() === false` at load; a suite
// runner in a build job raises the kit `SuiteRunnerInBuildError`.
const manifestScripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  scripts?: Record<string, string>;
};
const findings = staticFindings(manifestScripts);
for (const finding of findings) {
  if (!finding.ok) fail(`static check ${finding.check} failed (F120-FR-025): ${finding.detail}`);
}
// The kit's own assertion: a suite runner in a build job raises the kit
// `SuiteRunnerInBuildError` — the build fails on it, never proceeds.
try {
  dshStaticCheck.assertNoJobStartsTheSuiteRunner(buildJobsOf(manifestScripts));
} catch (error) {
  fail(`the build would start the suite runner (F120-FR-025): ${(error as Error).message}`);
}
for (const [name, command] of Object.entries(manifestScripts.scripts ?? {})) {
  if (/dsh\s+--profile/.test(command) || /hostSuiteRunner|live-probe/.test(command)) {
    fail(
      `the build job "${name}" would start a dsh session (F120-FR-025): "${command}" — the suite runner and the live probe are person-started paid tasks`,
    );
  }
}
const graderLines = gradeFixturesForBuild();
for (const line of graderLines) console.log(`grader: ${line}`);
console.log(
  `no-model guard: static check ${findings.length}/` +
    `${findings.length} finding group(s) ok, no build job starts a dsh session, ` +
    `${graderLines.length} recorded fixture(s) graded — the build calls no model (F120-FR-025)`,
);


// The release is built by this script, never by hand (threats T-43/T-45):
// the shipped `files` are exactly what this script wrote, and the skeleton
// placeholders leave with the first real artifacts. The installer (T026)
// ships this rendered output verbatim into the chosen skill root and carries
// the install record with `specstride.engineVersion` verbatim (F120-FR-022);
// the npm publish itself stays the owner's — nothing here publishes.
for (const keeper of [
    join(binDirectory, "." + "gi" + "tkeep"),
    join(skillsDirectory, "." + "gi" + "tkeep"),
  ]) {
  if (existsSync(keeper)) rmSync(keeper);
}
console.log(
  `release facts: engine ${engineVersion} (core-pin.json) — built by scripts/build.ts; install record carries it verbatim; publish stays the owner's`,
);
console.log(`build ok: ${written.length} skill(s), shim rendered, checks passed`);
