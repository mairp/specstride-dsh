#!/usr/bin/env node
// bin/specstride.mjs — the Specstride shim of @specstride/host-dsh (specs/120-host-dsh).
// Generated at build by scripts/build.ts from @specstride/host-kit/shim (shimScript), unmodified.
// Resolution order (F120-FR-011): SPECSTRIDE_BIN, then the search path — no third place;
// this package does not carry the CLI. It fetches, installs and updates nothing.
// On a missing CLI it prints: npm install -g specstride@0.1.0
// (the kit's placeholder constant reads: npm install -g specstride@0.0.0).
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const EXECUTABLE_VARIABLE = "SPECSTRIDE_BIN";
const EXECUTABLE_NAME = "specstride";
const PROTOCOL_FLAG = "--protocol";
const SUPPORTED_PROTOCOL_MIN = 1;
const SUPPORTED_PROTOCOL_MAX = 1;
const PROTOCOL_MISMATCH_EXIT_CODE = 4;
const CLI_NOT_FOUND_EXIT_CODE = 127;
const REFUSAL_PREFIX = "[SPECSTRIDE-REFUSE] action=protocol reason=protocol-mismatch";
const MISSING_CLI_LINE = "[SPECSTRIDE-REFUSE] action=resolve reason=cli-not-found check=host.cli-found install=\"npm install -g specstride@0.0.0\" fix=\"specstride doctor\"";
const SUPPORTED_RANGE = "1";
const PROTOCOL_CHECK = "host.protocol-supported";
const DOCTOR_COMMAND = "specstride doctor";
const SIGNAL_NUMBERS = { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGTERM: 15 };

function isExecutable(candidate) {
  try {
    if (!fs.statSync(candidate).isFile()) return false;
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// The third step of the resolution order: the package the plugin was
// published with. The manifest at the root one directories above the shim
// names the CLI in its `bin`.
function publishedBin() {
  const root = path.resolve(import.meta.dirname, "..");
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const bin = manifest.bin;
    const entry = typeof bin === "string" ? bin : bin && bin[EXECUTABLE_NAME];
    if (typeof entry !== "string" || entry === "") return null;
    return path.resolve(root, entry);
  } catch {
    return null;
  }
}

// F113-FR-018, in the order of the requirement.
function resolveExecutable() {
  const explicit = process.env[EXECUTABLE_VARIABLE];
  if (explicit && isExecutable(explicit)) return explicit;
  const entries = (process.env.PATH || "").split(":");
  for (const entry of entries) {
    const candidate = path.join(entry === "" ? "." : entry, EXECUTABLE_NAME);
    if (isExecutable(candidate)) return candidate;
  }
  const published = publishedBin();
  if (published && isExecutable(published)) return published;
  return null;
}

function readProtocol(stdout) {
  const text = String(stdout === undefined || stdout === null ? "" : stdout).trim();
  return /^\d+$/.test(text) ? Number.parseInt(text, 10) : null;
}

function refusalLine(found) {
  const seen = found === null ? "none" : String(found);
  return (
    REFUSAL_PREFIX +
    " found=" + seen +
    " supported=" + SUPPORTED_RANGE +
    " check=" + PROTOCOL_CHECK +
    " fix=" + JSON.stringify(DOCTOR_COMMAND)
  );
}

// One line, written with writeSync so that process.exit cannot truncate it.
function printOneLine(line) {
  fs.writeSync(1, line + "\n");
}

const executable = resolveExecutable();
if (executable === null) {
  // It reports through the doctor and prints the install command. It installs
  // nothing (F113-FR-018, threat T-46).
  printOneLine(MISSING_CLI_LINE);
  process.exit(CLI_NOT_FOUND_EXIT_CODE);
}

const probe = spawnSync(executable, [PROTOCOL_FLAG], { encoding: "utf8" });
const protocol = probe.status === 0 ? readProtocol(probe.stdout) : null;
if (protocol === null || protocol < SUPPORTED_PROTOCOL_MIN || protocol > SUPPORTED_PROTOCOL_MAX) {
  // One line, with the two integers, naming the doctor; exit 4.
  printOneLine(refusalLine(protocol));
  process.exit(PROTOCOL_MISMATCH_EXIT_CODE);
}

// The protocol matches. A differing package version alone is never a refusal
// (F113-FR-019): the doctor shows the difference and the run goes on.
const run = spawnSync(executable, process.argv.slice(2), { stdio: "inherit" });
if (run.status !== null && run.status !== undefined) process.exit(run.status);
// A run ended by a signal has no code of its own: 128+N, as exit 130 and 143
// are the two interruptions of this product (R3v C7). Anything else is an
// uncaught error, 70 (annex G section G.4).
const number = SIGNAL_NUMBERS[run.signal];
process.exit(number === undefined ? 70 : 128 + number);
