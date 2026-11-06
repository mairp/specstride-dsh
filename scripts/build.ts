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
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
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
    join(ROOT, "specs", "120-host-dsh", "contracts", "closed-sets.json"),
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
          join(ROOT, "specs", "120-host-dsh", "contracts", "doctor-host-checks.md"),
          dshInstallCommand(engineVersion),
        ).join("\n")}\n`
      : artifact.content;
  const composed = insertDshFrontmatter(logicalId, content);
  assertDshFrontmatter(composed, artifact.path); // fails the build, naming the artifact

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
console.log(`build ok: ${written.length} skill(s), shim rendered, checks passed`);
