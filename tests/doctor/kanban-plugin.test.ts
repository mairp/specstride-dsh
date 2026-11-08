/**
 * T048 — `host.kanban-plugin` (PT-121-019, F121-FR-019; research.md R11,
 * contracts/doctor-host-checks.md check 7). One temporary `DSH_HOME` per
 * case: absent profile manifest → `info`; a range spec (`^1.0.0`) → `warn`;
 * an exact pin → `ok` with `server half unknown` (never assumed). The check
 * is never launch-blocking and never starts dsh.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import {
  KANBAN_PLUGIN_NAME,
  dshDoctorChecks,
  kanbanPluginObservation,
  runDoctor,
  type DshObservations,
} from "../../src/doctor.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENGINE_VERSION = (
  JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    specstride?: { engineVersion?: string };
  }
).specstride!.engineVersion!;

const CHECKS = dshDoctorChecks(ENGINE_VERSION);
const CHECK = CHECKS.find((check) => check.id === "host.kanban-plugin")!;

/** A throwaway `DSH_HOME` whose web profile pins the given spec (or none). */
function homeWith(spec: string | null): string {
  const home = mkdtempSync(join(tmpdir(), "kanban-doctor-"));
  if (spec !== null) {
    mkdirSync(join(home, "profiles", "web"), { recursive: true });
    writeFileSync(
      join(home, "profiles", "web", "package.json"),
      JSON.stringify({
        name: "dsh-web-profile",
        version: "0.0.0",
        dependencies:
          spec === "(other)" || spec === "(dev)"
            ? { ["@other/plugin"]: "^1.0.0" }
            : { [KANBAN_PLUGIN_NAME]: spec },
        devDependencies:
          spec === "(dev)" ? { [KANBAN_PLUGIN_NAME]: "0.0.0" } : undefined,
      }),
      "utf8",
    );
  }
  return home;
}

function observationOf(
  kanban: DshObservations["kanban-plugin"],
): DshObservations {
  return {
    "cli-found": true,
    protocol: 1,
    "dsh-version": "0.1.0-rc.8",
    "skills-installed": { missing: [], stale: [], shadowed: [] },
    "state-root-writable": "writable",
    "permission-mode": { mode: "danger-full-access", approval: "answerable" },
    "kanban-plugin": kanban,
  };
}

async function findingFor(kanban: DshObservations["kanban-plugin"]) {
  const { findings } = await runDoctor(observationOf(kanban), {
    engineVersion: ENGINE_VERSION,
  });
  return findings.find((finding) => finding.id === "host.kanban-plugin")!;
}

test("host.kanban-plugin is the last member of the closed set, never launch-blocking", () => {
  const members = (
    JSON.parse(
      readFileSync(join(ROOT, "contracts", "closed-sets.json"), "utf8"),
    ) as { proposedByFeature: { id: string; members: string[] }[] }
  )
    .proposedByFeature.find((row) => row.id === "dsh-host-checks")!.members;
  assert.equal(members[members.length - 1], "host.kanban-plugin");
  assert.equal(CHECK.order, 7);
  assert.equal(CHECK.lb, false);
});

test("absent: the collector reads no manifest and the finding is info", async () => {
  const home = homeWith(null);
  const observed = kanbanPluginObservation({ DSH_HOME: home });
  assert.equal(observed.installed, false);
  const finding = await findingFor(observed);
  assert.equal(finding.severity, "info");
  assert.match(finding.message, /not installed/);
});

test("no DSH_HOME: the collector answers not installed, and reads nothing", () => {
  const observed = kanbanPluginObservation({});
  assert.equal(observed.installed, false);
  assert.equal(observed.serverHalf, "unknown");
});

test("a range spec (^1.0.0) warns; an exact pin is ok with server half unknown", async () => {
  const ranged = await findingFor(kanbanPluginObservation({ DSH_HOME: homeWith("^1.0.0") }));
  assert.equal(ranged.severity, "warn");
  assert.match(ranged.message, /range/);

  const exact = await findingFor(
    kanbanPluginObservation({
      DSH_HOME: homeWith("0.1.0"),
      // A start line seen on a log surface (none exists on dsh rc.8) is the
      // only way `started` is ever reported — never assumed (Principle XIV).
    }),
  );
  assert.equal(exact.severity, "ok");
  assert.match(exact.message, /server half unknown/);
  assert.equal(exact.evidence, "spec=exact serverHalf=unknown");
});

test("a devDependencies pin is read too; the collector is exact only for bare versions", () => {
  const dev = kanbanPluginObservation({ DSH_HOME: homeWith("(dev)") });
  assert.equal(dev.installed, true);
  assert.equal(dev.exact, true);
  const range = kanbanPluginObservation({ DSH_HOME: homeWith("~0.1.0") });
  assert.equal(range.exact, false);
});

test("the check is filterable by id and unknown ids still exit with the kit's usage error", async () => {
  const { findings, exit } = await runDoctor(observationOf(null), {
    engineVersion: ENGINE_VERSION,
    filter: ["host.kanban-plugin", "host.not-a-check"],
  });
  assert.deepEqual(findings.map((finding) => finding.id), ["host.kanban-plugin"]);
  assert.notEqual(exit, 0);
});
