/**
 * T007 — the skill-set binding and the build pipeline
 * (F120-FR-001, F120-FR-004, F120-FR-026).
 * Three directories under `skills/`, `<name>/SKILL.md` each; bodies contain
 * no `CLAUDE_`, `/specstride:`, `.claude-plugin`, `claude plugin`; the doctor
 * body carries no appendix yet (that lands with T021).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const SKILL_NAMES = ["specstride-run", "specstride-reverse", "specstride-doctor"];

function builtSkills(): Record<string, string> {
  // Run the build as the gate does, so the test observes the shipped state.
  execFileSync(
    process.execPath,
    ["--experimental-strip-types", join("scripts", "build.ts")],
    { cwd: ROOT, stdio: "pipe" },
  );
  const skills: Record<string, string> = {};
  for (const name of SKILL_NAMES) {
    const file = join(ROOT, "skills", name, "SKILL.md");
    assert.ok(existsSync(file), `skills/${name}/SKILL.md exists`);
    skills[name] = readFileSync(file, "utf8");
  }
  return skills;
}

test("the build renders three directories, <name>/SKILL.md each", () => {
  const skills = builtSkills();
  for (const name of SKILL_NAMES) {
    assert.match(skills[name], /^---\nname: /);
    assert.match(skills[name], /user-invocable: true/);
  }
  assert.match(skills["specstride-run"], /disable-model-invocation: false/);
  assert.match(skills["specstride-reverse"], /disable-model-invocation: false/);
  assert.match(skills["specstride-doctor"], /disable-model-invocation: true/);
});

test("bodies contain no Claude host leakage", () => {
  const skills = builtSkills();
  for (const name of SKILL_NAMES) {
    const text = skills[name];
    assert.ok(!text.includes("CLAUDE_"), `${name} holds CLAUDE_`);
    assert.ok(!text.includes("/specstride:"), `${name} holds /specstride:`);
    assert.ok(!text.includes(".claude-plugin"), `${name} holds .claude-plugin`);
    assert.ok(!text.includes("claude plugin"), `${name} holds "claude plugin"`);
  }
});

test("the doctor body carries the generated host-checks appendix (T021)", () => {
  const skills = builtSkills();
  assert.ok(
    skills["specstride-doctor"].includes("specstride-host-dsh doctor"),
    "the host-checks appendix is in the composed doctor body",
  );
  assert.match(skills["specstride-doctor"], /disable-model-invocation: true/);
  assert.match(skills["specstride-doctor"], /user-invocable: true/);
});

test("the run and reverse bodies carry the generated dsh runtime section", () => {
  const skills = builtSkills();
  assert.match(skills["specstride-run"], /dsh runtime notes/);
  assert.match(skills["specstride-run"], /run_in_background: true.*forbidden|forbidden.*run_in_background: true/);
  assert.match(skills["specstride-run"], /specstride-dsh/);
  assert.match(skills["specstride-run"], /DSH_PERMISSION_MODE=danger-full-access/);
  assert.match(skills["specstride-reverse"], /dsh runtime notes/);
  assert.match(skills["specstride-reverse"], /owned by the calling session/);
});

test("each skill stays inside its F120-FR-026 budget", () => {
  const skills = builtSkills();
  const budgets: Record<string, number> = {
    "specstride-run": 22_400,
    "specstride-reverse": 19_600,
    "specstride-doctor": 4_200,
  };
  for (const [name, limit] of Object.entries(budgets)) {
    const bytes = Buffer.byteLength(skills[name], "utf8");
    assert.ok(bytes <= limit, `${name}: ${bytes} bytes over ${limit}`);
  }
});
