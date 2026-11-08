#!/usr/bin/env node
// T010 — the stub CLI (research.md R3). Answers only `--protocol`, `status --json` and
// `wait --until-change [--cursor X] [--timeout N]`, step by step from STUB_SCRIPT.
//
// STUB_SCRIPT  path of a JSON file: { "protocol": 1, "steps": [ step, ... ] }
//   step = "no-state" | "no-feature" | "unchanged" | "hang"
//        | { "view": <object> } | { "file": <path of a JSON file> }
//        | { "changed": "<status line ending in cur=...>" } | { "exit": <code> }
//   The step used by a call is the number of earlier non-probe calls recorded in STUB_LOG;
//   past the last step the last one repeats.
// STUB_LOG     path; one JSON line per call: { argv, cwd, probe }. Probes are the shim's `--protocol`.
// Any other argv: exit 3.
import fs from "node:fs";

const NO_STATE =
  '{"schema":"specstride.inspect.status/1","cmd":"status","ok":false,"reason":"no-state","fix":"run the engine once, or pass --feature to name the run"}';
const NO_FEATURE =
  '{"schema":"specstride.inspect.status/1","cmd":"status","ok":false,"reason":"no-feature","fix":"pass --feature with the slug of the feature"}';
const WAIT_USAGE =
  "usage: specstride wait --until-change [--cursor <offset>.<seq>.<sig>] [--timeout <seconds>] [--feature <slug>]";

const argv = process.argv.slice(2);
const script = process.env.STUB_SCRIPT ? JSON.parse(fs.readFileSync(process.env.STUB_SCRIPT, "utf8")) : { steps: [] };
const logPath = process.env.STUB_LOG;
const probe = argv.length === 1 && argv[0] === "--protocol";

let index = 0;
if (logPath && fs.existsSync(logPath)) {
  index = fs
    .readFileSync(logPath, "utf8")
    .split("\n")
    .filter((line) => line !== "" && JSON.parse(line).probe !== true).length;
}
if (logPath) fs.appendFileSync(logPath, `${JSON.stringify({ argv, cwd: process.cwd(), probe })}\n`);

const out = (text) => fs.writeSync(1, `${text}\n`);
const err = (text) => fs.writeSync(2, `${text}\n`);

if (probe) {
  out(String(script.protocol ?? 1));
  process.exit(0);
}

function waitUsage(problem) {
  err(`specstride wait: ${problem}`);
  err(WAIT_USAGE);
  process.exit(3);
}

const verb = argv[0];
if (verb === "status" && argv.length === 2 && argv[1] === "--json") {
  // accepted
} else if (verb === "wait") {
  let untilChange = false;
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--until-change") untilChange = true;
    else if (arg === "--cursor" || arg === "--timeout" || arg === "--feature") i += 1;
    else waitUsage(`unknown argument ${arg}`);
  }
  if (!untilChange) waitUsage("wait needs --until-change");
} else {
  err(`stub-cli: refused argv ${JSON.stringify(argv)}`);
  process.exit(3);
}

const steps = script.steps ?? [];
const step = steps.length === 0 ? "unchanged" : steps[Math.min(index, steps.length - 1)];

if (step === "no-state") {
  out(NO_STATE);
  process.exit(1);
} else if (step === "no-feature") {
  out(NO_FEATURE);
  process.exit(1);
} else if (step === "unchanged") {
  process.exit(0);
} else if (step === "hang") {
  setInterval(() => {}, 1 << 30);
} else if (typeof step === "object" && step !== null) {
  if ("view" in step) {
    out(JSON.stringify(step.view));
    process.exit(0);
  } else if ("file" in step) {
    out(JSON.stringify(JSON.parse(fs.readFileSync(step.file, "utf8"))));
    process.exit(0);
  } else if ("changed" in step) {
    out(step.changed);
    process.exit(0);
  } else if ("exit" in step) {
    process.exit(step.exit);
  } else {
    err("stub-cli: unreadable step");
    process.exit(3);
  }
} else {
  err("stub-cli: unreadable step");
  process.exit(3);
}
