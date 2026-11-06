/**
 * T019 — the doctor missing-CLI test (PT-120-011; F120-FR-011, F120-FR-016).
 *
 * With no CLI reachable via `SPECSTRIDE_BIN` or PATH, `host.cli-found` is the
 * one launch check (`lb: true`) and fails with the install command
 * version-inlined from the pinned release, printed and NEVER run; protocol
 * unprobeable → `warn`; exit codes come from the kit `DOCTOR_EXITS` (annex G
 * §G.4), read at load, never restated; an unknown id in a filter exits 3; a
 * check that throws is a `fail` and the doctor exits 1.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DOCTOR_EXITS,
  DOCTOR_EXIT_CODES,
  meaningOfExit,
} from "@specstride/host-kit";
import {
  EXIT_WHEN_A_CHECK_THROWS,
  UNKNOWN_CHECK_ID_IN_A_FILTER_EXIT_CODE,
  type DoctorCheck,
} from "@specstride/contracts/ep/doctor";
import { readDoctorFindings } from "@specstride/contracts/records/doctor-findings";
import {
  dshDoctorChecks,
  dshDoctorExits,
  runDoctor,
  runDoctorFindings,
  collectObservations,
} from "../../src/doctor.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(
  readFileSync(join(ROOT, "package.json"), "utf8"),
) as { specstride?: { engineVersion?: string } };
const ENGINE_VERSION = manifest.specstride!.engineVersion!;
const INSTALL_COMMAND = `npm install -g specstride@${ENGINE_VERSION}`;

test("no CLI reachable: host.cli-found fails with the version-inlined install command", async () => {
  const execCalls: string[][] = [];
  const observations = await collectObservations(
    { PATH: "", SPECSTRIDE_BIN: "" } as NodeJS.ProcessEnv,
    {
      execFile: async (_file, args) => {
        execCalls.push([_file, ...args]);
        throw new Error("no CLI on this machine");
      },
    },
  );
  const { findings, output, exit } = await runDoctor(observations, {
    engineVersion: ENGINE_VERSION,
  });
  const cli = findings.find((f) => f.id === "host.cli-found")!;
  assert.equal(cli.severity, "fail");
  assert.equal(cli.lb, true);
  assert.match(output, new RegExp(INSTALL_COMMAND.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(cli.fix, INSTALL_COMMAND);
  // Printed, never run: nothing executes the install command or the CLI
  // itself (only the separate dsh --version probe may have been attempted).
  assert.equal(
    execCalls.filter(([file, ...args]) =>
      /specstride|npm|install/.test(file) || args.join(" ").includes("install"),
    ).length,
    0,
  );
  // host.protocol-supported is unprobeable → warn, never fail.
  const protocol = findings.find((f) => f.id === "host.protocol-supported")!;
  assert.equal(protocol.severity, "warn");
  assert.equal(
    exit,
    DOCTOR_EXITS.find((e) => /at least one `fail`/.test(e.meaning))!.code,
  );
});

test("host.cli-found is the one launch check among the findings", () => {
  const checks = dshDoctorChecks(ENGINE_VERSION);
  assert.deepEqual(
    checks.filter((check) => check.lb).map((check) => check.id),
    ["host.cli-found"],
  );
});

test("exit codes come from the kit DOCTOR_EXITS, read at load, never restated", () => {
  const exits = dshDoctorExits();
  assert.equal(exits, DOCTOR_EXITS); // the kit's array itself, not a copy
  for (const exit of exits) assert.equal(exit.meaning, meaningOfExit(exit.code));
  // The module never hard-codes an exit code outside the kit's four.
  const source = readFileSync(join(ROOT, "src", "doctor.ts"), "utf8");
  for (const code of DOCTOR_EXIT_CODES) {
    // The literal may only appear if the kit's constant is unavailable —
    // this module imports the constants from the contracts, so it must not
    // carry its own numeric table.
    assert.ok(
      !new RegExp(`exit[^\\n]*=\\s*${code}\\b`).test(source),
      `src/doctor.ts does not restate exit code ${code}`,
    );
  }
});

test("an unknown id in a filter exits 3", async () => {
  const { exit } = await runDoctor(
    {
      "cli-found": true,
      protocol: 1,
      "dsh-version": "0.1.0-rc.8",
      "skills-installed": { missing: [], stale: [], shadowed: [] },
      "state-root-writable": "writable",
      "permission-mode": { mode: "danger-full-access", approval: "answerable" },
    },
    { engineVersion: ENGINE_VERSION, filter: ["host.cli-found", "host.nope"] },
  );
  assert.equal(exit, UNKNOWN_CHECK_ID_IN_A_FILTER_EXIT_CODE);
  assert.equal(exit, 3);
});

test("a check that throws is a fail and the doctor exits 1", async () => {
  const throwing: DoctorCheck = {
    ...dshDoctorChecks(ENGINE_VERSION)[3],
    probe: () => {
      throw new Error("probe exploded");
    },
  };
  const { findings } = runDoctorFindings([throwing], {
    "cli-found": true,
    protocol: 1,
    "dsh-version": "0.1.0-rc.8",
    "skills-installed": { missing: [], stale: [], shadowed: [] },
    "state-root-writable": "writable",
    "permission-mode": { mode: "danger-full-access", approval: "answerable" },
  });
  const observations = {
    "cli-found": true,
    protocol: 1,
    "dsh-version": "0.1.0-rc.8",
    "skills-installed": { missing: [], stale: [], shadowed: [] },
    "state-root-writable": "writable",
    "permission-mode": { mode: "danger-full-access", approval: "answerable" },
  } as const;
  const thrownResult = await runDoctorFindings([throwing], observations);
  const finding = thrownResult.findings.find(
    (f) => f.id === "host.skills-installed",
  )!;
  assert.equal(finding.severity, "fail");
  assert.equal(thrownResult.thrown, true);
  assert.equal(thrownResult.exit, EXIT_WHEN_A_CHECK_THROWS);
  assert.equal(EXIT_WHEN_A_CHECK_THROWS, 1);
});

test("--json is the EP-14 finding shape (specstride.doctor/1)", async () => {
  const { json } = await runDoctor(
    {
      "cli-found": false,
      protocol: null,
      "dsh-version": null,
      "skills-installed": { missing: [], stale: [], shadowed: [] },
      "state-root-writable": "blocked",
      "permission-mode": { mode: "workspace-write", approval: "answerable" },
    },
    { engineVersion: ENGINE_VERSION, json: true },
  );
  const record = readDoctorFindings(JSON.parse(json!)); // refuses an invalid shape
  assert.equal(record.exit, 2); // at least one fail finding
  assert.equal(record.host, "dsh");
  assert.ok(record.findings.length >= 6);
});
