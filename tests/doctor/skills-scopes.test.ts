/**
 * host.skills-installed across the install scopes (HF-01 ranks).
 *
 * An install in any of the three install scopes (project, user, shared)
 * satisfies the check. The loaded copy is the highest-rank one. A
 * higher-rank copy at another version shadows this package's copy below it,
 * and a loaded copy at another version with no current copy anywhere is stale.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { skillsInstalledObservation } from "../../src/doctor.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const VERSION = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }).version;
const SKILLS = ["specstride-run", "specstride-reverse", "specstride-doctor"];

function place(root: string, version: string, names: readonly string[] = SKILLS): void {
  for (const name of names) {
    mkdirSync(join(root, name), { recursive: true });
    writeFileSync(join(root, name, "SKILL.md"), `---\nname: ${name}\nmetadata:\n  version: ${version}\n---\n`);
  }
}

function sandbox() {
  const base = mkdtempSync(join(tmpdir(), "host-dsh-scopes-"));
  const project = join(base, "project");
  const dshHome = join(base, "dsh-home");
  const home = join(base, "home");
  for (const dir of [project, dshHome, home]) mkdirSync(dir, { recursive: true });
  const env = { PROJECT_ROOT: project, DSH_HOME: dshHome, HOME: home } as NodeJS.ProcessEnv;
  return { project, dshHome, home, env };
}

const clean = { missing: [], stale: [], shadowed: [] };

test("a project-scope install satisfies the check", () => {
  const s = sandbox();
  place(join(s.project, ".dsh", "skills"), VERSION);
  assert.deepEqual(skillsInstalledObservation(s.env), clean);
});

test("a user-scope install satisfies the check", () => {
  const s = sandbox();
  place(join(s.dshHome, "skills"), VERSION);
  assert.deepEqual(skillsInstalledObservation(s.env), clean);
});

test("a shared-scope install satisfies the check", () => {
  const s = sandbox();
  place(join(s.home, ".agents", "skills"), VERSION);
  assert.deepEqual(skillsInstalledObservation(s.env), clean);
});

test("without PROJECT_ROOT the working directory is the project root", () => {
  const s = sandbox();
  place(join(s.project, ".dsh", "skills"), VERSION);
  const env = { DSH_HOME: s.dshHome, HOME: s.home } as NodeJS.ProcessEnv;
  assert.deepEqual(skillsInstalledObservation(env, s.project), clean);
});

test("no root holds a skill: missing", () => {
  const s = sandbox();
  place(join(s.dshHome, "skills"), VERSION, ["specstride-run"]);
  assert.deepEqual(skillsInstalledObservation(s.env).missing, ["specstride-reverse", "specstride-doctor"]);
});

test("a higher-rank copy at another version shadows the current one", () => {
  const s = sandbox();
  place(join(s.dshHome, "skills"), VERSION);
  place(join(s.project, ".dsh", "skills"), "9.9.9", ["specstride-run"]);
  const o = skillsInstalledObservation(s.env);
  assert.deepEqual(o.missing, []);
  assert.deepEqual(o.stale, []);
  assert.deepEqual(o.shadowed, [{ name: "specstride-run", root: join(s.project, ".dsh", "skills"), version: "9.9.9" }]);
});

test("the loaded copy at another version, none current anywhere: stale", () => {
  const s = sandbox();
  place(join(s.dshHome, "skills"), "9.9.9");
  const o = skillsInstalledObservation(s.env);
  assert.deepEqual(o.stale, SKILLS);
  assert.deepEqual(o.shadowed, []);
});
