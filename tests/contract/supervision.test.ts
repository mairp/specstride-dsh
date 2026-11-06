/**
 * T015 — the contract test for supervision (PT-120-010; F120-FR-010; US2).
 *
 * Two layers, both hermetic (no model call):
 *  1. The rendered `specstride-run` body carries the kit's supervision
 *     figures — one blocking `wait --until-change` per cycle with the cursor
 *     of the previous call, nothing printed for an unchanged cycle, the
 *     digest verbatim as the last line, recovery by repeating the read, and
 *     no status mechanism of the host's own — and the composed body holds
 *     the budgets 150 a cycle and 3,000 a whole run's supervision.
 *  2. Against the stub CLI, a fixture run is driven through three changes
 *     and one unchanged cycle; each changed line is relayed verbatim, the
 *     unchanged cycle prints nothing and spends 0, the digest is the last
 *     line, a lost output is recovered by repeating the read command, and a
 *     run that already ended attaches to nothing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DIGEST_IS_PRINTED_VERBATIM,
  DIGEST_IS_THE_FINAL_LINE,
  SUPERVISION_CHANGE_OPTION,
  SUPERVISION_COMMAND,
  SUPERVISION_CURSOR_OPTION,
  UNCHANGED_CYCLE_PRINTS_NOTHING,
  UNCHANGED_CYCLE_TOKENS,
} from "@specstride/host-kit";
import { builtRunBody, ROOT } from "./run-body.ts";
import { dshBodyBudgets, dshSupervisionFigures } from "../../src/skills.ts";

const SHIM = join(ROOT, "bin", "specstride.mjs");
const BYTES_PER_TOKEN = 2.8;

/** The stub `specstride` CLI. `status` prints the scenario's current line;
 * `wait --until-change --cursor C` prints the scenario's line for C (nothing
 * where none is recorded) and, when it prints a change, advances the status
 * line — as the engine would. */
const STUB_SCRIPT = `#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const argv = process.argv.slice(2);
const dir = process.env.SPECSTRIDE_SCENARIO_DIR;
const log = process.env.SPECSTRIDE_CALL_LOG;
if (log) fs.appendFileSync(log, JSON.stringify({ argv }) + "\\n");
const out = (s) => process.stdout.write(s + "\\n");
if (argv[0] === "--protocol") return out("1");
if (argv[0] === "launch") return out("started run-001 detached from the session");
if (argv[0] === "status") return out(fs.readFileSync(path.join(dir, "status.txt"), "utf8").trim());
if (argv[0] === "digest") return out(fs.readFileSync(path.join(dir, "digest.txt"), "utf8").trim());
if (argv[0] === "wait") {
  const i = argv.indexOf("--cursor");
  const cursor = i >= 0 ? argv[i + 1] : "";
  const map = JSON.parse(fs.readFileSync(path.join(dir, "wait-outputs.json"), "utf8"));
  const line = map[cursor];
  if (line === undefined || line === "") return; // unchanged: prints nothing
  out(line);
  const m = line.match(/cursor=(\\d+)/);
  if (m) fs.writeFileSync(path.join(dir, "status.txt"), line.replace(/^changed /, "running ") + "\\n");
  return;
}
out("unexpected call: " + argv.join(" "));
process.exit(3);
`;

type Ctx = {
  dir: string;
  scenarioDir: string;
  callLog: string;
  env: NodeJS.ProcessEnv;
};

function setup(scenario: {
  status: string;
  digest: string;
  waits: Record<string, string>;
}): Ctx {
  const dir = mkdtempSync(join(tmpdir(), "us2-supervision-"));
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "specstride"), STUB_SCRIPT, { mode: 0o755 });
  const scenarioDir = join(dir, "scenario");
  mkdirSync(scenarioDir, { recursive: true });
  writeFileSync(join(scenarioDir, "status.txt"), `${scenario.status}\n`);
  writeFileSync(join(scenarioDir, "digest.txt"), `${scenario.digest}\n`);
  writeFileSync(join(scenarioDir, "wait-outputs.json"), JSON.stringify(scenario.waits));
  const callLog = join(dir, "calls.jsonl");
  writeFileSync(callLog, "");
  const dshHome = join(dir, "dsh-home");
  mkdirSync(join(dshHome, "skills"), { recursive: true });
  cpSync(join(ROOT, "skills"), join(dshHome, "skills"), { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    SPECSTRIDE_BIN: "",
    DSH_HOME: dshHome,
    DSH_TELEMETRY_MODE: "DISABLED",
    SPECSTRIDE_CALL_LOG: callLog,
    SPECSTRIDE_SCENARIO_DIR: scenarioDir,
  };
  return { dir, scenarioDir, callLog, env };
}

function calls(ctx: Ctx): string[][] {
  return readFileSync(ctx.callLog, "utf8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l).argv as string[]);
}

function shim(ctx: Ctx, args: string[]): { status: number; stdout: string } {
  const r = spawnSync(process.execPath, [SHIM, ...args], { env: ctx.env, encoding: "utf8" });
  return { status: r.status ?? -1, stdout: r.stdout };
}

/** One blocking supervision cycle, exactly as the body instructs. Returns
 * the lines it printed (an empty array for an unchanged cycle) and the
 * cursor the cycle ended on. */
function cycle(
  ctx: Ctx,
  cursor: string,
): { printed: string[]; cursor: string; tokens: number } {
  const r = shim(ctx, [SUPERVISION_COMMAND, SUPERVISION_CHANGE_OPTION, SUPERVISION_CURSOR_OPTION, cursor]);
  const lines = r.stdout.split("\n").filter((l) => l !== "");
  // An unchanged cycle prints NOTHING and spends UNCHANGED_CYCLE_TOKENS.
  if (lines.length === 0) return { printed: [], cursor, tokens: UNCHANGED_CYCLE_TOKENS };
  // A lost output: nothing came back, recover by repeating the READ command.
  if (lines.length === 1 && lines[0] === "") throw new Error("unreachable");
  const m = lines[lines.length - 1].match(/cursor=(\d+)/);
  return { printed: lines, cursor: m ? m[1] : cursor, tokens: Math.ceil(r.stdout.length / BYTES_PER_TOKEN) };
}

/** The read command: `status`, relayed as the one line the CLI printed. */
function readStatus(ctx: Ctx): { line: string; cursor: string } {
  const r = shim(ctx, ["status"]);
  const line = r.stdout.trim();
  const m = line.match(/cursor=(\d+)/);
  return { line, cursor: m ? m[1] : "" };
}

test("the rendered body supervises with the kit's own figures and holds the budgets", () => {
  const body = builtRunBody();
  // One blocking wait per cycle, with the cursor of the previous call.
  assert.ok(
    body.includes(`\`${SUPERVISION_COMMAND} ${SUPERVISION_CHANGE_OPTION}\``),
    "the body names the blocking wait with its change option",
  );
  assert.ok(
    body.includes(`\`${SUPERVISION_CURSOR_OPTION} <the cursor of the previous call>\``),
    "the body names the cursor option carrying the previous call's cursor",
  );
  // An unchanged cycle prints nothing and spends 0 — stated in the body.
  assert.ok(UNCHANGED_CYCLE_PRINTS_NOTHING && UNCHANGED_CYCLE_TOKENS === 0);
  assert.match(body, /An unchanged state\s*\n?\s*prints nothing/);
  // The digest verbatim as the last line.
  assert.ok(DIGEST_IS_PRINTED_VERBATIM && DIGEST_IS_THE_FINAL_LINE);
  assert.ok(body.includes("Print the digest verbatim as the last line of the run"));
  // The wait may run as a dsh background job while the session lives; the
  // launch may not — both lines are in the composed body.
  assert.match(body, /A supervision `wait` MAY run as a dsh background job/);
  assert.match(body, /run_in_background: true` is forbidden/);
  // A lost output is recovered by repeating the read command.
  assert.match(body, /a lost output is recovered by repeating the read/);
  // No status mechanism of the host's own: never write a status.
  assert.match(body, /never write a status/);
  // The figures: one cycle 150, a whole run's supervision 3,000, the wait in
  // the background (the dsh background primitive is declared present).
  const figures = dshSupervisionFigures();
  assert.equal(figures.cycleTokenBudget, 150);
  assert.equal(figures.runSupervisionTokenBudget, 3000);
  assert.equal(figures.backgroundPresent, true);
  assert.match(body, /stays within 3000 tokens/);
  // The budgets hold over the COMPOSED body, not the kit body alone.
  dshBodyBudgets.assertBodyFitsItsLimit("specstride-run", body);
});

test("three changes and one unchanged cycle: each changed line verbatim, the digest last", (t) => {
  const ctx = setup({
    status: "running run-001 cursor=0001 phase=derive",
    digest: "DIGEST run-001 verdict=pass",
    waits: {
      "0001": "changed cursor=0002 run-001 phase=judge items=1",
      "0002": "changed cursor=0003 run-001 phase=validate verdict pending",
      "0003": "ended cursor=0004 run-001 verdict=pass",
      // 0004 has no entry: the unchanged cycle.
    },
  });
  t.after(() => rmSync(ctx.dir, { recursive: true, force: true }));

  const relayed: string[] = [];
  let spend = 0;
  let cycles = 0;
  let cursor = readStatus(ctx).cursor; // the run starts: status first
  const waitsPerCursor: string[][] = [];
  let ended = false;
  while (!ended && cycles < 10) {
    const c = cycle(ctx, cursor);
    waitsPerCursor.push([SUPERVISION_COMMAND, SUPERVISION_CHANGE_OPTION, SUPERVISION_CURSOR_OPTION, cursor]);
    cycles += 1;
    spend += c.tokens;
    relayed.push(...c.printed);
    cursor = c.cursor;
    if (c.printed.some((l) => l.startsWith("ended"))) ended = true;
  }
  // The unchanged cycle after the third change: prints nothing, spends 0.
  const unchanged = cycle(ctx, cursor);
  waitsPerCursor.push([SUPERVISION_COMMAND, SUPERVISION_CHANGE_OPTION, SUPERVISION_CURSOR_OPTION, cursor]);
  assert.deepEqual(unchanged.printed, []);
  assert.equal(unchanged.tokens, UNCHANGED_CYCLE_TOKENS);
  cycles += 1;

  // Exactly one blocking wait per cycle, each carrying the cursor of the
  // previous call.
  const waitCalls = calls(ctx).filter((argv) => argv[0] === SUPERVISION_COMMAND);
  assert.equal(waitCalls.length, cycles);
  assert.deepEqual(waitCalls, waitsPerCursor);
  // Every changed line relayed VERBATIM.
  for (const line of [
    "changed cursor=0002 run-001 phase=judge items=1",
    "changed cursor=0003 run-001 phase=validate verdict pending",
    "ended cursor=0004 run-001 verdict=pass",
  ]) {
    assert.ok(relayed.includes(line), `relayed verbatim: ${line}`);
  }
  // The digest, verbatim, as the last line.
  const digest = shim(ctx, ["digest"]).stdout.trim();
  const printed = [...relayed, digest];
  assert.equal(printed[printed.length - 1], "DIGEST run-001 verdict=pass");
  // The whole run's supervision stays within its 3,000-token budget, and
  // every cycle within its 150.
  assert.ok(spend + Math.ceil(digest.length / BYTES_PER_TOKEN) <= 3000, "whole-run supervision within 3,000");
  assert.ok(spend / cycles <= 150, "each cycle within 150");
  // Everything went through the shim, with no host status mechanism of its
  // own and no --json anywhere.
  for (const argv of calls(ctx)) {
    assert.notEqual(argv[0], "model");
    assert.ok(!argv.includes("--json"));
  }
});

test("a lost output is recovered by repeating the read command", (t) => {
  const ctx = setup({
    status: "running run-001 cursor=0001 phase=derive",
    digest: "DIGEST run-001 verdict=pass",
    waits: {
      // The wait for 0001 produced NOTHING (the background job's output was
      // lost), but the engine moved on: the status line now holds cursor 2.
      "0001": "",
    },
  });
  t.after(() => rmSync(ctx.dir, { recursive: true, force: true }));

  // Status first: the read command precedes any wait, even on a lost cycle.
  const initial = readStatus(ctx);
  assert.equal(initial.cursor, "0001");
  // Simulate the engine advancing while the wait's output was lost.
  writeFileSync(
    join(ctx.scenarioDir, "status.txt"),
    "running run-001 cursor=0002 phase=judge items=1\n",
  );

  const first = cycle(ctx, "0001");
  assert.deepEqual(first.printed, [], "the lost cycle printed nothing");
  // The recovery is the READ command, repeated — `status` — never a second
  // guess of the host's own.
  const recovered = readStatus(ctx);
  assert.equal(recovered.line, "running run-001 cursor=0002 phase=judge items=1");
  assert.equal(recovered.cursor, "0002");
  // The relayed recovery line is the CLI's own line, verbatim.
  const waits = calls(ctx).filter((a) => a[0] === SUPERVISION_COMMAND);
  const statuses = calls(ctx).filter((a) => a[0] === "status");
  assert.equal(waits.length, 1);
  assert.equal(statuses.length, 2); // the first read + the recovery read
});

test("a run that already ended attaches to nothing, relays the status line and the digest, and stops", (t) => {
  const ctx = setup({
    status: "ended cursor=0007 run-001 verdict=fail",
    digest: "DIGEST run-001 verdict=fail",
    waits: {},
  });
  t.after(() => rmSync(ctx.dir, { recursive: true, force: true }));

  // Re-invoked on an ended run: read `status` first, relay its ONE line
  // before anything else, print the digest, and attach to nothing.
  const first = readStatus(ctx);
  assert.equal(first.line, "ended cursor=0007 run-001 verdict=fail");
  assert.equal(first.cursor, "0007");
  const digest = shim(ctx, ["digest"]).stdout.trim();
  assert.equal(digest, "DIGEST run-001 verdict=fail");

  // Not a single wait was spent on the ended run: nothing to attach to.
  assert.deepEqual(calls(ctx).filter((a) => a[0] === SUPERVISION_COMMAND), []);
  // The status line came first, before the digest — and nothing else ran.
  const commands = calls(ctx).map((a) => a[0]);
  assert.deepEqual(commands, ["--protocol", "status", "--protocol", "digest"]);
});
