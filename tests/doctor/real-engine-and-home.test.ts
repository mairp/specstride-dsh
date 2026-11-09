/**
 * The doctor sees what the shim and dsh see (fix, 2026-11-09):
 *
 * - a `specstride` that answers no `--protocol` (the bash engine first on
 *   PATH) is not a CLI the shim can use: every launch refuses with
 *   `found=none`, so `host.cli-found` fails and its fix names that
 *   executable and SPECSTRIDE_BIN;
 * - with no DSH_HOME set, dsh uses `~/.dsh`, so the doctor reads the web
 *   profile and the skills there;
 * - a `file:` tarball pin of the kanban plugin is one fixed artifact, not a
 *   range.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectObservations,
  dshHomeOf,
  kanbanPluginObservation,
  runDoctor,
} from "../../src/doctor.ts";

const ENGINE_VERSION = "0.1.0";

function fakeCli(): string {
  const dir = mkdtempSync(join(tmpdir(), "doctor-cli-"));
  const path = join(dir, "specstride");
  writeFileSync(path, "#!/bin/sh\nexit 3\n");
  chmodSync(path, 0o755);
  return path;
}

test("a specstride that answers no --protocol fails host.cli-found and the fix names it and SPECSTRIDE_BIN", async () => {
  const path = fakeCli();
  const observations = await collectObservations(
    { PATH: "", SPECSTRIDE_BIN: path, HOME: "" } as NodeJS.ProcessEnv,
    { execFile: async () => { throw new Error("orchestrator.sh: unknown arg: --protocol"); } },
  );
  assert.deepEqual(observations["cli-found"], { path, answersProtocol: false });
  const { findings } = await runDoctor(observations, { engineVersion: ENGINE_VERSION });
  const cli = findings.find((f) => f.id === "host.cli-found")!;
  assert.equal(cli.severity, "fail");
  assert.ok(cli.fix.startsWith(`${path} answers no --protocol`), cli.fix);
  assert.match(cli.fix, /SPECSTRIDE_BIN/);
  assert.match(cli.fix, /npm install -g specstride@0\.1\.0/);
});

test("a specstride that answers --protocol keeps host.cli-found ok with the plain install fix", async () => {
  const path = fakeCli();
  const observations = await collectObservations(
    { PATH: "", SPECSTRIDE_BIN: path, HOME: "" } as NodeJS.ProcessEnv,
    { execFile: async (file) => (file === path ? "1\n" : "0.1.0-rc.8\n") },
  );
  assert.deepEqual(observations["cli-found"], { path, answersProtocol: true });
  const { findings } = await runDoctor(observations, { engineVersion: ENGINE_VERSION });
  const cli = findings.find((f) => f.id === "host.cli-found")!;
  assert.equal(cli.severity, "ok");
  assert.equal(cli.fix, "npm install -g specstride@0.1.0");
});

test("with no DSH_HOME the doctor uses dsh's default ~/.dsh", () => {
  assert.equal(dshHomeOf({ DSH_HOME: "/x", HOME: "/h" }), "/x");
  assert.equal(dshHomeOf({ HOME: "/h" }), join("/h", ".dsh"));
  assert.equal(dshHomeOf({ DSH_HOME: "", HOME: "/h" }), join("/h", ".dsh"));
  assert.equal(dshHomeOf({}), null);
});

test("the kanban plugin pinned as a file: tarball under ~/.dsh is installed and exact", () => {
  const home = mkdtempSync(join(tmpdir(), "doctor-home-"));
  mkdirSync(join(home, ".dsh", "profiles", "web"), { recursive: true });
  writeFileSync(join(home, ".dsh", "profiles", "web", "package.json"), JSON.stringify({
    dependencies: { "@specstride/dsh-kanban": "file:/abs/specstride-dsh-kanban-0.0.0.tgz" },
  }));
  const observed = kanbanPluginObservation({ HOME: home });
  assert.equal(observed.installed, true);
  assert.equal(observed.exact, true);
});

test("host.skills-installed fails when the skills' shim specstride-dsh is not on PATH, and the fix says so", async () => {
  const { skillsInstalledObservation } = await import("../../src/doctor.ts");
  const empty = mkdtempSync(join(tmpdir(), "doctor-path-"));
  const observed = skillsInstalledObservation({ PATH: empty, HOME: "" } as NodeJS.ProcessEnv, empty);
  assert.equal(observed.shimOnPath, false);
  const { findings } = await runDoctor({ "skills-installed": { ...observed, missing: [] } }, { engineVersion: ENGINE_VERSION });
  const skills = findings.find((f) => f.id === "host.skills-installed")!;
  assert.equal(skills.severity, "fail");
  assert.match(skills.fix, /specstride-dsh <cmd>`, which is not on PATH/);

  const bin = mkdtempSync(join(tmpdir(), "doctor-bin-"));
  writeFileSync(join(bin, "specstride-dsh"), "#!/bin/sh\n");
  chmodSync(join(bin, "specstride-dsh"), 0o755);
  assert.equal(skillsInstalledObservation({ PATH: bin, HOME: "" } as NodeJS.ProcessEnv, empty).shimOnPath, true);
});
