/**
 * The core smoke test of the dsh repository (the split, phase 5): the pinned
 * core tarballs install, import and serve the host port, without any of
 * core's source in this repository. It is the first check a fresh clone runs
 * after `node scripts/core-pin.mjs <version> <path-to-core>` and
 * `npm install --ignore-scripts`.
 *
 * What it holds:
 *
 * 1. the pin is what installed — every row of `core-pin.json` digests the
 *    bytes in `vendor/core/` and names the version that sits under
 *    `node_modules/`;
 * 2. the host port is reachable — the CLI protocol integer is 1 (the
 *    assumption of spec 120), the refusal line and the row-144 ids come
 *    through `@specstride/host-kit`, so a plugin here needs no import of
 *    core beyond the pinned packages;
 * 3. host-kit renders through THIS host's spelling (logical id `doctor` →
 *    `specstride-doctor`, a 500-character description cap, no colon
 *    namespace) and the rendered body carries none of the Claude host's
 *    vocabulary — the property U-1 was bought for;
 * 4. the shim core renders as a standalone script that imports nothing
 *    beyond Node built-ins and holds no local tree path — it is copied into
 *    a plugin as one file at build time, not imported at run time;
 * 5. the pinned CLI answers its handshake: `specstride --protocol` prints
 *    the protocol integer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLI_PROTOCOL_VERSION,
  DOCTOR_SKILL_ID,
  PROTOCOL_MISMATCH_LINE,
  UnknownLogicalIdError,
  assertBudgetTables,
  HOST_SKILL_AND_ENTRY_IDS,
  renderSkill,
} from "@specstride/host-kit";
// The shim is deliberately NOT on the kit's root index: it is the one part
// that imports nothing and is rendered as a standalone file, so it is
// reached through its own subpath.
import { shimScript } from "@specstride/host-kit/shim";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const pin = JSON.parse(readFileSync(join(ROOT, "core-pin.json"), "utf8"));

/**
 * The dsh render profile: the second spelling of the split, as spec 120
 * renders it (logical ids spelled as the product's own contract spells them,
 * a 500-character description cap, no colon namespace, the layout
 * `skills/<spelling>/SKILL.md`, the rate of 2.8 bytes per token).
 * @type {import("@specstride/host-kit").SkillRenderProfile}
 */
const DSH = {
  bytesPerToken: 2.8,
  maxBodyLines: 200,
  descriptionCap: 500,
  skillFile: "SKILL.md",
  skillsDirectory: "skills",
  spellings: {
    run: "specstride-run",
    reverse: "specstride-reverse",
    doctor: DOCTOR_SKILL_ID,
  },
  tokenBudgets: { doctor: 1_000, run: 4_000, reverse: 2_000 },
  printedByteBudgets: { doctor: 2_800, run: 11_200, reverse: 5_600 },
  budgetRequirement: "the dsh host's budget requirement (spec 120, F120-FR-005)",
};

test("the pin is what installed: the vendored bytes digest to the record, at the recorded versions", () => {
  assert.match(pin.coreCommit, /^[0-9a-f]{40}$/);
  for (const row of pin.packages) {
    const tarball = join(ROOT, "vendor", "core", row.file);
    const digest = createHash("sha256").update(readFileSync(tarball)).digest("hex");
    assert.equal(digest, row.sha256, `${row.file}: vendor bytes match the pin`);
    const installed = JSON.parse(
      readFileSync(join(ROOT, "node_modules", ...row.name.split("/"), "package.json"), "utf8"),
    );
    assert.equal(installed.version, row.version, `${row.name}: installed at the pinned version`);
  }
});

test("the host port is reachable from the pinned packages alone", () => {
  // The assumption of spec 120 ("the engine's CLI protocol is integer 1 at
  // the time of writing") holds in the pinned core.
  assert.equal(CLI_PROTOCOL_VERSION, 1);
  assert.match(PROTOCOL_MISMATCH_LINE, /^\[SPECSTRIDE-REFUSE\]/);
  // Row 144 of the context-cost table, re-exported by host-kit: the ids a
  // host declares costs for. `specstride-run` and `specstride-reverse` come
  // out spelled; the doctor id is the logical one the profile spells below.
  assert.deepEqual(HOST_SKILL_AND_ENTRY_IDS, ["specstride-run", "specstride-reverse", "doctor"]);
});

test("host-kit renders the doctor skill through the dsh spelling, with no Claude vocabulary", () => {
  assert.doesNotThrow(() => assertBudgetTables(DSH));
  const descriptionCap = 500;
  const rendered = renderSkill(
    {
      logicalId: "doctor",
      body: "# The doctor\n\nRun the host checks of the dsh plugin.\n",
      references: [],
      budget: 2_800,
    },
    DSH,
    // The description at exactly the cap the dsh profile declares.
    { description: "d".repeat(descriptionCap) },
  );
  // The spelling is the dsh one, in the layout the profile names.
  assert.match(rendered.content, /specstride-doctor/);
  assert.ok(rendered.content.length > 0);
  // The body rule the kit's own tests hold: no vocabulary of the Claude host.
  assert.doesNotMatch(rendered.content, /CLAUDE_/);
  assert.doesNotMatch(rendered.content, /\/specstride:/);
  assert.doesNotMatch(rendered.content, /\.claude-plugin/);
  assert.doesNotMatch(rendered.content, /claude plugin/);
  // And the unknown-value rule: an id outside the row fails the build.
  assert.throws(
    () =>
      renderSkill({ logicalId: "teleport", body: "x", references: [], budget: 2_800 }, DSH),
    (error) => {
      assert.ok(error instanceof UnknownLogicalIdError);
      assert.equal(error.code, "unknown-logical-id");
      return true;
    },
  );
  // One character over the cap is a budget refusal, named in the host's own
  // requirement words.
  assert.throws(
    () =>
      renderSkill(
        {
          logicalId: "doctor",
          body: "# The doctor\n",
          references: [],
          budget: 2_800,
        },
        DSH,
        { description: "d".repeat(descriptionCap + 1) },
      ),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /budget-exceeded/);
      assert.match(error.message, /limit is 500/);
      assert.match(error.message, /F120-FR-005/);
      return true;
    },
  );
});

test("the shim core renders standalone: Node built-ins only, no local tree path", () => {
  // dsh carries no bundled CLI in its plugin directory (the engine arrives
  // through SPECSTRIDE_BIN or the search path), so the shim is rendered
  // without the bundled-CLI block.
  const script = shimScript({ bundledCliSegments: [] });
  assert.match(script, /^#!\/usr\/bin\/env node/);
  assert.match(script, /SPECSTRIDE_BIN/);
  // Every import is a Node built-in: the file is copied into a plugin as a
  // standalone script, so nothing else may be reached.
  const specifiers = [
    ...script.matchAll(/import\s+(?:[\w{}\s,*$]+\s+from\s+)?["']([^"']+)["']/g),
  ].map((match) => match[1]);
  assert.ok(specifiers.length > 0);
  for (const specifier of specifiers) {
    assert.match(specifier, /^node:/, `shim imports only Node built-ins, saw ${specifier}`);
  }
  // The denylist rule of the split: no local tree path in anything rendered.
  assert.doesNotMatch(script, /\/root\//);
});

test("the pinned CLI answers its handshake", () => {
  const stdout = execFileSync(join(ROOT, "node_modules", ".bin", "specstride"), ["--protocol"], {
    encoding: "utf8",
  });
  assert.equal(stdout.trim(), String(CLI_PROTOCOL_VERSION));
});
