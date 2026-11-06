/**
 * T014 — the story's independent test, run hermetically (User Story 1).
 *
 * In a hermetic `DSH_HOME` with the skills installed and a stub `specstride`
 * CLI on the PATH, the rendered `specstride-run` skill's command sequence is
 * executed (stub agents, oracle fixtures, NO model call): the calls arrive in
 * the order of F120-FR-004, the outcome line is relayed verbatim, and no file
 * of the fixture repository changed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RUN_STEP_IDS, stepsOfMode, decideMode } from "@specstride/host-kit";
import { ROOT } from "./run-body.ts";

const SHIM = join(ROOT, "bin", "specstride.mjs");

/** A file tree's sha256 digest, over sorted relative paths and contents. */
function treeDigest(root: string): string {
  const hash = createHash("sha256");
  const walk = (dir: string, prefix: string) => {
    for (const name of readdirSorted(dir)) {
      const full = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (statIsDirectory(full)) walk(full, rel);
      else hash.update(`${rel}\0${createHash("sha256").update(readFileSync(full)).digest("hex")}\0`);
    }
  };
  walk(root, "");
  return hash.digest("hex");
}
import { readdirSync, statSync } from "node:fs";
const readdirSorted = (d: string) => readdirSync(d).sort();
const statIsDirectory = (p: string) => statSync(p).isDirectory();

/** The stub `specstride` CLI: logs every argv, prints canned terse lines, writes nothing. */
const STUB_SCRIPT = `#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const argv = process.argv.slice(2);
const log = process.env.SPECSTRIDE_CALL_LOG;
if (log) fs.appendFileSync(log, JSON.stringify({ argv }) + "\\n");
const out = (s) => process.stdout.write(s + "\\n");
if (argv[0] === "--protocol") return out("1");
if (argv[0] === "contract" && argv[1] === "derive") {
  if (argv.includes("--answer")) return out("answered batch-001 remaining=0");
  return out("derived draft draft-001 remaining=1 batch batch-001 items=1");
}
if (argv[0] === "contract" && argv[1] === "validate") return out("validation verdict: pass");
if (argv[0] === "contract" && argv[1] === "promote") return out("promoted draft-001");
if (argv[0] === "contract" && argv[1] === "render") return out("rendered bundle bundle-001");
if (argv[0] === "launch") return out("started run-001 detached from the session");
if (argv[0] === "wait") return out("changed cursor=0002");
if (argv[0] === "digest") return out("DIGEST run-001 verdict=pass");
out("unexpected call: " + argv.join(" "));
process.exit(3);
`;

type Ctx = {
  dir: string;
  fixture: string;
  callLog: string;
  modelLog: string;
  env: NodeJS.ProcessEnv;
  before: string;
};

function setup(): Ctx {
  const dir = mkdtempSync(join(tmpdir(), "us1-hermetic-"));
  const fixture = join(dir, "fixture-repo");
  mkdirSync(join(fixture, "src"), { recursive: true });
  writeFileSync(join(fixture, "README.md"), "# fixture\n");
  writeFileSync(join(fixture, "src", "app.ts"), "export const app = 1;\n");
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  const stub = join(bin, "specstride");
  writeFileSync(stub, STUB_SCRIPT, { mode: 0o755 });
  const dshHome = join(dir, "dsh-home");
  // Install: the three rendered skills into a user-scope root of the hermetic DSH_HOME.
  mkdirSync(join(dshHome, "skills"), { recursive: true });
  cpSync(join(ROOT, "skills"), join(dshHome, "skills"), { recursive: true });
  const callLog = join(dir, "calls.jsonl");
  const modelLog = join(dir, "model-calls.jsonl");
  writeFileSync(callLog, "");
  writeFileSync(modelLog, "");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    SPECSTRIDE_BIN: "", // exercise the shim's search path, not the override
    DSH_HOME: dshHome,
    DSH_TELEMETRY_MODE: "DISABLED",
    SPECSTRIDE_CALL_LOG: callLog,
    SPECSTRIDE_MODEL_LOG: modelLog,
  };
  return { dir, fixture, callLog, modelLog, env, before: treeDigest(fixture) };
}

function calls(ctx: Ctx): string[][] {
  return readFileSync(ctx.callLog, "utf8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l).argv as string[]);
}

/** One shim call through the stub CLI: the only channel the skill has. */
function shim(ctx: Ctx, args: string[]): { status: number; stdout: string } {
  const r = spawnSync(process.execPath, [SHIM, ...args], { env: ctx.env, encoding: "utf8" });
  return { status: r.status ?? -1, stdout: r.stdout };
}

/** Execute the skill's sequence, in F120-FR-004 order, for one mode. */
function driveRun(ctx: Ctx, comment: string, mode: "run" | "dry-run") {
  const steps = stepsOfMode(mode);
  const printed: string[] = [];
  const flags = decideMode({ explicit: mode === "run" ? undefined : mode, comment });
  const call = (args: string[]) => {
    const r = shim(ctx, args);
    printed.push(...r.stdout.split("\n").filter((l) => l !== ""));
    return r;
  };

  // Step 1 is a model step: the comment is captured verbatim, before any read.
  assert.equal(steps[0].id, "capture-the-comment");
  // Step 2: the shim's CLI check.
  const check = call(["--protocol"]);
  assert.equal(check.status, 0);
  // Step 3: derive, comment verbatim as ONE argument (kit callArguments).
  const derive = call(["contract", "derive", "--repo", ctx.fixture, "--comment", comment]);
  assert.equal(derive.status, 0);
  // Step 4: judge — the oracle fixture answers the one batch deterministically.
  if (derive.stdout.includes("remaining=1")) {
    call([
      "contract", "derive", "--repo", ctx.fixture,
      "--answer", "batch-001", "item-001=option-a",
    ]);
  }
  if (mode === "dry-run") {
    // DRY_RUN_LAST_STEP: validate, print the plan and the verdict, launch nothing.
    const verdict = call(["contract", "validate", ctx.fixture]);
    assert.equal(verdict.status, 0);
    assert.equal(flags.mode, "dry-run");
    return { printed, launched: false };
  }
  // Step 5: validate and promote.
  assert.match(call(["contract", "validate", ctx.fixture]).stdout, /pass/);
  call(["contract", "promote", ctx.fixture]);
  // Step 6: render. Step 7: launch, comment unchanged.
  call(["contract", "render", ctx.fixture]);
  const launch = call(["launch", "--repo", ctx.fixture, "--comment", comment]);
  assert.equal(launch.status, 0);
  const outcomeLine = launch.stdout.trim();
  // Step 8: the outcome line is relayed VERBATIM.
  printed.push(outcomeLine);
  if (outcomeLine.startsWith("started")) {
    // Step 9: supervise. Step 10: the digest, verbatim as the last line.
    call(["wait", "--until-change", "--cursor", "0001"]);
    const digest = call(["digest", ctx.fixture]);
    assert.match(digest.stdout, /^DIGEST /);
    printed.push(digest.stdout.trim());
  }
  return { printed, launched: true, outcomeLine };
}

test("hermetic run: the F120-FR-004 sequence, the outcome verbatim, the fixture untouched", (t) => {
  const ctx = setup();
  t.after(() => rmSync(ctx.dir, { recursive: true, force: true }));
  const comment = "please `run` it   with odd  spacing and \"quotes\"";

  const result = driveRun(ctx, comment, "run");

  // The calls arrived in the order of F120-FR-004 (= RUN_STEP_IDS). Every
  // call goes through the shim, and the shim runs its CLI check (its own
  // `--protocol` step of F120-FR-011) before each one, so the log
  // interleaves probe, call, probe, call…
  const log = calls(ctx);
  const commands = log.map((argv) => argv[0] === "contract" ? `contract ${argv[1]}` : argv[0]);
  assert.equal(commands[0], "--protocol");
  const callsOnly = commands.filter((c) => c !== "--protocol");
  assert.deepEqual(
    callsOnly,
    ["contract derive", "contract derive", "contract validate", "contract promote", "contract render", "launch", "wait", "digest"],
  );
  for (let i = 0; i < log.length; i += 2) {
    assert.equal(log[i][0], "--protocol", `probe precedes call ${i / 2}`);
  }
  // The comment passed verbatim as ONE --comment argument, on derive and again on launch.
  const deriveCall = log.find((argv) => argv[0] === "contract" && argv[1] === "derive");
  const launchCall = log.find((argv) => argv[0] === "launch");
  assert.deepEqual(deriveCall!.slice(-2), ["--comment", comment]);
  assert.deepEqual(launchCall!.slice(-2), ["--comment", comment]);
  // The outcome line is relayed verbatim: what the CLI printed is what is printed.
  assert.equal(result.outcomeLine, "started run-001 detached from the session");
  assert.equal(result.printed[result.printed.length - 1], "DIGEST run-001 verdict=pass");
  // Zero files of the fixture repository changed.
  assert.equal(treeDigest(ctx.fixture), ctx.before);
  // Zero model calls: no process outside the shim/stub channel ran.
  assert.equal(readFileSync(ctx.modelLog, "utf8"), "");
  assert.ok(!calls(ctx).some((argv) => argv[0] === "model" || argv.join(" ").includes("--json")));
});

test("hermetic dry-run: stops at validation, prints the plan and the verdict, launches nothing", (t) => {
  const ctx = setup();
  t.after(() => rmSync(ctx.dir, { recursive: true, force: true }));
  const comment = "do not run yet, just show me the plan";

  const result = driveRun(ctx, comment, "dry-run");

  const log = calls(ctx);
  assert.equal(result.launched, false);
  assert.ok(!log.some((argv) => argv[0] === "launch"), "dry-run launches nothing");
  assert.ok(!log.some((argv) => argv[0] === "wait" || argv[0] === "digest"));
  assert.deepEqual(
    log.map((argv) => argv[0] === "contract" ? `contract ${argv[1]}` : argv[0]).filter((c) => c !== "--protocol"),
    ["contract derive", "contract derive", "contract validate"],
  );
  assert.deepEqual(log.find((argv) => argv[0] === "contract")!.slice(-2), ["--comment", comment]);
  assert.match(result.printed.join("\n"), /validation verdict: pass/);
  assert.equal(treeDigest(ctx.fixture), ctx.before);
  assert.equal(readFileSync(ctx.modelLog, "utf8"), "");
});

test("the skills are installed into the hermetic DSH_HOME and the shim resolves through the PATH", (t) => {
  const ctx = setup();
  t.after(() => rmSync(ctx.dir, { recursive: true, force: true }));
  for (const name of ["specstride-run", "specstride-reverse", "specstride-doctor"]) {
    assert.ok(existsSync(join(ctx.env.DSH_HOME!, "skills", name, "SKILL.md")), `${name} installed`);
  }
  const check = shim(ctx, ["--protocol"]);
  assert.equal(check.status, 0);
  assert.equal(check.stdout.trim(), "1");
  assert.equal(calls(ctx).length, 2); // the shim's own probe, then the call
});
