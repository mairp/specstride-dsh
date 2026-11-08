/**
 * T018 — the doctor mode-matrix test (PT-120-016, PT-120-017;
 * specs/120-host-dsh/contracts/doctor-host-checks.md, "Mode matrix").
 *
 * For `workspace-write` + `ask` — `host.state-root-writable` warns with the
 * fix exactly `DSH_PERMISSION_MODE=danger-full-access` (or a writable root
 * that includes the state home, clause marked `unverified` in
 * src/host-facts.ts), never an offer to move state into the working tree, and
 * `host.permission-mode` is `info`; for headless with no approver — checks 5
 * and 6 warn with the no-approver fact; for `danger-full-access` — both `ok`.
 * The doctor installs and changes nothing in any mode.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { DOCTOR_EXIT_CODES } from "@specstride/host-kit";
import {
  DSH_STATE_ROOT_FIX,
  dshDoctorChecks,
  runDoctor,
  type DshObservations,
} from "../../src/doctor.ts";
import { dshHostFacts } from "../../src/host-facts.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENGINE_VERSION = (
  JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    specstride?: { engineVersion?: string };
  }
).specstride!.engineVersion!;

const CHECKS = dshDoctorChecks(ENGINE_VERSION);

function observationOf(
  overrides: Partial<DshObservations>,
): DshObservations {
  return {
    "cli-found": true,
    protocol: 1,
    "dsh-version": "0.1.0-rc.8",
    "skills-installed": { missing: [], stale: [], shadowed: [] },
    "state-root-writable": "blocked",
    "permission-mode": { mode: "workspace-write", approval: "answerable" },
    ...overrides,
  };
}

test("the seven checks are the closed set, in its order; only cli-found is launch-blocking", () => {
  const closedSet = JSON.parse(
    readFileSync(
      join(ROOT, "contracts", "closed-sets.json"),
      "utf8",
    ),
  ) as {
    proposedByFeature: { id: string; members: string[] }[];
  };
  const members = closedSet.proposedByFeature.find(
    (row) => row.id === "dsh-host-checks",
  )!.members;
  assert.deepEqual(
    CHECKS.map((check) => check.id),
    members,
  );
  assert.deepEqual(
    CHECKS.filter((check) => check.lb).map((check) => check.id),
    ["host.cli-found"],
  );
  for (const check of CHECKS) {
    assert.ok(
      Buffer.byteLength(check.messageTemplate, "utf8") <= 200,
      `${check.id}: messageTemplate within the 200-byte cap`,
    );
    assert.equal(typeof check.severityRule, "function");
    assert.equal(typeof check.order, "number");
    assert.equal(typeof check.fixHint, "string");
  }
});

test("workspace-write + ask: state-root-writable warns with the exact fix; permission-mode is info", async () => {
  const { findings, exit } = await runDoctor(
    observationOf({}),
    { engineVersion: ENGINE_VERSION },
  );
  const state = findings.find((f) => f.id === "host.state-root-writable")!;
  assert.equal(state.severity, "warn");
  assert.equal(state.fix, DSH_STATE_ROOT_FIX);
  assert.match(state.fix, /^DSH_PERMISSION_MODE=danger-full-access/);
  assert.match(state.fix, /unverified/); // the writable-root clause (host-facts, unverified)
  assert.doesNotMatch(state.fix, /working tree/); // never an offer to move state there
  assert.doesNotMatch(state.message, /working tree/);
  const mode = findings.find((f) => f.id === "host.permission-mode")!;
  assert.equal(mode.severity, "info");
  // Nothing else fails in this mode, so the doctor exits clean.
  assert.equal(exit, DOCTOR_EXIT_CODES[0]);
});

test("headless with no approver: checks 5 and 6 warn with the no-approver fact", async () => {
  const { findings } = await runDoctor(
    observationOf({
      "permission-mode": { mode: "workspace-write", approval: "no-approver" },
    }),
    { engineVersion: ENGINE_VERSION },
  );
  const state = findings.find((f) => f.id === "host.state-root-writable")!;
  const mode = findings.find((f) => f.id === "host.permission-mode")!;
  assert.equal(state.severity, "warn");
  assert.equal(mode.severity, "warn");
  const fact = dshHostFacts.find((row) => /no approver/.test(row.fact))!;
  assert.ok(fact, "the host-facts table carries the no-approver fact");
  assert.match(mode.message + " " + mode.fix, /no approver/);
});

test("danger-full-access: both checks are ok", async () => {
  const { findings } = await runDoctor(
    observationOf({
      "state-root-writable": "writable",
      "permission-mode": { mode: "danger-full-access", approval: "answerable" },
    }),
    { engineVersion: ENGINE_VERSION },
  );
  assert.equal(
    findings.find((f) => f.id === "host.state-root-writable")!.severity,
    "ok",
  );
  assert.equal(
    findings.find((f) => f.id === "host.permission-mode")!.severity,
    "ok",
  );
});

function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const rel = `${prefix}/${entry}`;
      const stats = statSync(full);
      if (stats.isDirectory()) walk(full, rel);
      else
        out[rel] = createHash("sha256")
          .update(readFileSync(full))
          .digest("hex");
    }
  };
  walk(root, "");
  return out;
}

test("the doctor installs and changes nothing (hermetic fixture, every mode)", () => {
  const home = mkdtempSync(join(tmpdir(), "dsh-doctor-home-"));
  const state = mkdtempSync(join(tmpdir(), "dsh-doctor-state-"));
  const emptyPath = mkdtempSync(join(tmpdir(), "dsh-doctor-path-"));
  const before = snapshot(home);
  const beforeState = snapshot(state);
  const env = {
    ...process.env,
    PATH: emptyPath,
    DSH_HOME: home,
    XDG_STATE_HOME: state,
    DSH_PERMISSION_MODE: "",
    SPECSTRIDE_BIN: "",
  } as NodeJS.ProcessEnv;
  for (const mode of ["", "danger-full-access"]) {
    try {
      execFileSync(
        process.execPath,
        [join(ROOT, "bin", "specstride-host-dsh.mjs"), "doctor"],
        {
          cwd: ROOT,
          env: { ...env, DSH_PERMISSION_MODE: mode },
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
    } catch {
      // a fixture without a CLI fails a finding — that is the doctor working
    }
  }
  assert.deepEqual(snapshot(home), before, "DSH_HOME unchanged");
  assert.deepEqual(snapshot(state), beforeState, "state home unchanged");
});
