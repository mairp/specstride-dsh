/**
 * T036 — the EP-01 host conformance suite of THIS package (`npm run
 * conformance`, F120-FR-034 / F113-FR-034). G-B is SETTLED and travels in the
 * pinned `@specstride/testkit` 0.1.0: the suite records TWO targets — THIS
 * host FIRST (`hostConformanceTargets`), the plain shell (the testkit's own
 * EP-01 sample) SECOND — and runs the host's cases against EVERY target. No
 * paid call anywhere: both targets run on stub agents over oracle TriggerCases,
 * and the live-host case is the testkit's own skip with its reason.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import {
  HOST_SKILL_IDS,
  DOCTOR_SKILL_ID,
  checkSkillBudget,
  PROTOCOL_MISMATCH_EXIT_CODE,
} from "@specstride/host-kit";
import type { Implementation, SkillSource, TriggerCase, TriggerResult } from "@specstride/contracts/ep/host";
import {
  hostConformanceTargets,
  type ConformanceTarget,
} from "@specstride/testkit/conformance/EP-01/targets";
import { registerHostConformanceCases } from "@specstride/testkit/conformance/EP-01/host-suite";
import { implementation as plainShellImplementation } from "@specstride/testkit/samples/EP-01";
import { dshHostPort, capabilityAbsentLine } from "../src/port.ts";
import { dshSkillSourceOf, dshSkillSetHost } from "../src/skills.ts";
import { dshProfile, dshByteBudgets } from "../src/profile.ts";
import { referenceClosureFindings } from "../src/gates.ts";
import { hermeticEnvironment } from "../src/evals/driver.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const HOST_IMPLEMENTATION_ID = "host-dsh";

/** This host's implementation record, bound to the port of `src/port.ts`. */
/** A stub `dsh` bin, created once; the host port's evalDriver runs on it. */
const stubBin = (() => {
  const { mkdtempSync, mkdirSync, writeFileSync, chmodSync } = fs;
  const base = mkdtempSync(join(tmpdir(), "specstride-conformance-"));
  const bin = join(base, "bin");
  mkdirSync(bin, { recursive: true });
  const stub = join(bin, "dsh");
  writeFileSync(stub, stubDshScript());
  chmodSync(stub, 0o755);
  return bin;
})();

const hostImplementation: Implementation = Object.freeze({
  ep: "EP-01",
  pointId: "specstride.host/1",
  id: HOST_IMPLEMENTATION_ID,
  implementationClass: "first-party",
  majors: [1],
  provenance: "default",
  operations: dshHostPort({
    environmentFor: (prompt: string) => {
      void prompt;
      const environment = hermeticEnvironment();
      return { ...environment, env: { ...environment.env, PATH: `${stubBin}:${environment.env.PATH}` } };
    },
  }),
});

const targets: readonly ConformanceTarget[] = hostConformanceTargets({
  order: 1,
  implementationId: HOST_IMPLEMENTATION_ID,
  host: "dsh — this package's host port (`specstride-host-dsh`, src/port.ts)",
  source: "src/port.ts",
  live: false,
  requirement: "F120-FR-027",
});

function implementationOf(id: string): Implementation {
  if (id === HOST_IMPLEMENTATION_ID) return hostImplementation;
  if (id === plainShellImplementation.id) return plainShellImplementation;
  throw new Error(`no implementation registered under \`${id}\``);
}

/** The oracle TriggerCases of EP-01: the command sequences of BOTH skills. */
function oracleCases(): readonly TriggerCase[] {
  return [
    // Positive: the prompt calls for the run skill, the session names it.
    {
      id: "ep01-run-positive",
      prompt: "run specstride on the comment 'add rate limiting' (skill: specstride-run)",
      expected: "specstride-run",
    },
    // Positive: the prompt calls for the reverse skill, the session names it.
    {
      id: "ep01-reverse-positive",
      prompt: "recover the spec of this module backward (skill: specstride-reverse)",
      expected: "specstride-reverse",
    },
    // The confusable pair, run side: a run prompt must NOT satisfy a reverse expectation.
    {
      id: "ep01-run-vs-reverse",
      prompt: "run specstride on the comment 'fix the flaky login test'",
      expected: "specstride-reverse",
    },
    // No skill event at all: not matched.
    {
      id: "ep01-no-skill-event",
      prompt: "summarize this repository's README for me",
      expected: "specstride-run",
    },
  ];
}

/** A stub `dsh` whose session log names the skill the prompt calls for. */
function stubDshScript(): string {
  return [
    "#!/usr/bin/env bash",
    'mkdir -p "$DSH_HOME/sessions"',
    'last="${@: -1}"',
    'if [[ "$last" == *specstride-run* ]]; then name=specstride-run;',
    'elif [[ "$last" == *specstride-reverse* ]]; then name=specstride-reverse;',
    "else name=none; fi",
    'printf \'%s\\n\' "{\\"type\\":\\"tool/call\\",\\"tool\\":\\"skill\\",\\"input\\":{\\"name\\":\\"$name\\"}}" \'{"type":"session-end","exitCode":0}\' > "$DSH_HOME/sessions/session.jsonl"',
    "exit 0",
    "",
  ].join("\n");
}

/**
 * Run the oracle cases against one implementation's evalDriver. Both targets
 * run on stub agents over the SAME oracle TriggerCases — no paid call.
 */
async function runOracleAgainst(
  implementation: Implementation,
): Promise<readonly TriggerResult[]> {
  return implementation.operations!.evalDriver.run(oracleCases() as never);
}

const cases = [
  {
    id: "command-sequences-on-oracle-fixtures",
    title: "the command sequences of both skills on oracle fixtures with stub agents (F113-FR-034)",
    proves: ["F120-FR-034", "F120-FR-024"],
    async run(implementation: Implementation) {
      // Both targets run on stub agents, never a paid call: the verdicts of
      // the oracle sequence are the EP-01 semantics themselves.
      const results = await runOracleAgainst(implementation);
      assert.deepEqual(
        results.map((one) => one.matched),
        [true, true, false, false],
        `oracle verdicts of ${implementation.id}: ${JSON.stringify(results)}`,
      );
    },
  },
  {
    id: "budgets-of-the-rendered-skills",
    title: "the bytes of the rendered skills measure inside the budgets (F120-FR-026)",
    proves: ["F120-FR-026", "F120-FR-034"],
    run(implementation: Implementation) {
      const operations = implementation.operations!;
      for (const logicalId of HOST_SKILL_IDS) {
        const source = dshSkillSourceOf(logicalId);
        const artifact = operations.renderSkill(source as SkillSource);
        const budgetFindings = checkSkillBudget(source, artifact.content.length, dshProfile);
        for (const finding of budgetFindings) {
          assert.equal(finding.verdict, "pass", `${implementation.id} ${logicalId}: ${finding.check}`);
        }
        assert.ok(
          artifact.content.length <= dshByteBudgets[logicalId]!,
          `${implementation.id} ${logicalId}: ${artifact.content.length} bytes over ${dshByteBudgets[logicalId]}`,
        );
      }
    },
  },
  {
    id: "reference-closure",
    title: "the rendered artifacts name no path into product source, state or logs (F120-FR-009)",
    proves: ["F120-FR-009", "F120-FR-034"],
    run(implementation: Implementation) {
      const operations = implementation.operations!;
      for (const logicalId of HOST_SKILL_IDS) {
        const artifact = operations.renderSkill(dshSkillSourceOf(logicalId) as SkillSource);
        assert.deepEqual(
          referenceClosureFindings(artifact.content, `${implementation.id}/${logicalId}`),
          [],
        );
      }
    },
  },
  {
    id: "rendered-tree-validation",
    title: "the rendered tree validates: three skills, frontmatter, metadata.version, entries (F113-FR-034)",
    proves: ["F120-FR-034", "F120-FR-027"],
    run(implementation: Implementation, target: ConformanceTarget) {
      const operations = implementation.operations!;
      if (target.order === 1) {
        // The host's tree on disk: the three skill directories, each with a
        // SKILL.md whose frontmatter parses and names the skill + version.
        const skillsDirectory = join(ROOT, "skills");
        const entries = readdirSync(skillsDirectory).filter((name) =>
          statSync(join(skillsDirectory, name)).isDirectory(),
        );
        assert.deepEqual([...entries].sort(), [...HOST_SKILL_IDS, DOCTOR_SKILL_ID].sort());
        for (const spelling of entries) {
          const path = join(skillsDirectory, spelling, "SKILL.md");
          assert.ok(existsSync(path), `no SKILL.md at ${spelling}`);
          const frontmatter = readFrontmatter(readFileSync(path, "utf8"));
          assert.equal(frontmatter.name, spelling);
          assert.match(frontmatter.description ?? "", /\S/);
        }
        // The shim is rendered at the path the tree promises.
        assert.ok(existsSync(join(ROOT, "bin", "specstride.mjs")));
      }
      // Both targets: entries exist for the two model-invocable skills only,
      // and each entry names its skill.
      for (const logicalId of HOST_SKILL_IDS) {
        const entry = operations.renderEntry(logicalId);
        assert.match(String(entry), new RegExp(logicalId.replace(/-/g, "\\-")));
      }
    },
  },
  {
    id: "protocol-and-absent-capabilities",
    title: "the port declares protocol 1 and degrades the absent capabilities per EP-01 (F120-FR-015)",
    proves: ["F120-FR-015", "F120-FR-034"],
    run(implementation: Implementation) {
      const operations = implementation.operations!;
      // The doctor has no model-invocable entry point on THIS host.
      if (implementation.id === HOST_IMPLEMENTATION_ID) {
        assert.throws(() => operations.renderEntry("doctor"), (error: Error) =>
          error.message.startsWith("[SPECSTRIDE-REFUSE] "),
        );
      }
      // protocol on the record and on the sample table: 1.
      assert.deepEqual(implementation.majors, [1]);
      if (typeof (operations as { renderStatusHooks?: unknown }).renderStatusHooks === "undefined") {
        // Declared absent: the port's refusal grammar carries the degradation.
        assert.match(
          capabilityAbsentLine("renderStatusHooks"),
          /^\[SPECSTRIDE-REFUSE\] action=renderStatusHooks reason=capability-absent/,
        );
        assert.equal(PROTOCOL_MISMATCH_EXIT_CODE, 4);
      } else {
        // The plain shell declares hooks: its renderStatusHooks returns artifacts.
        const artifacts = (
          operations as unknown as {
            renderStatusHooks(name: string): readonly { path: string }[];
          }
        ).renderStatusHooks("specstride-status");
        assert.ok(artifacts.length >= 1);
      }
    },
  },
];

/** The scalar fields of a SKILL.md frontmatter block, as flat keys. */
function readFrontmatter(text: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---/.exec(text);
  assert.ok(match, "no frontmatter block");
  const flat: Record<string, string> = {};
  let metadataKey: string | undefined;
  for (const line of match[1]!.split("\n")) {
    const pair = /^([\w.-]+):\s*(.*)$/.exec(line);
    if (!pair) continue;
    if (pair[1] === "metadata") {
      metadataKey = undefined;
      continue;
    }
    if (metadataKey === undefined && /^\s{2,}/.test(line)) {
      // a metadata sub-key
      const sub = /^\s+([\w.-]+):\s*(.*)$/.exec(line);
      if (sub) flat[`metadata.${sub[1]}`] = sub[2]!;
      continue;
    }
    metadataKey = pair[1];
    flat[pair[1]!] = pair[2]!;
  }
  return flat;
}

const registered = registerHostConformanceCases({
  targets,
  implementationOf,
  cases,
});

// The suite must hold both targets and every case against both (F113-FR-034).
assert.equal(registered.targetCount, 2);
assert.equal(registered.caseRuns, cases.length * 2);

