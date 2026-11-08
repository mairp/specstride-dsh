/**
 * Shared setup for the server tests: the stub peer that stands in for
 * `@specstride/host-dsh/bin/specstride.mjs` (T017) and small helpers for the
 * STUB_LOG/STUB_SCRIPT files. The stub lives in the package's own
 * `node_modules`, exactly where a peer resolves from inside a dsh profile.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const repoRoot = join(packageRoot, "..", "..");

export const stubPeerRoot = join(packageRoot, "node_modules", "@specstride", "host-dsh");
export const stubShimPath = join(stubPeerRoot, "bin", "specstride.mjs");

const STUB_SHIM = `#!/usr/bin/env node
// T017 — the stub peer shim. Answers only --protocol and "kanban status --json",
// step by step from KANBAN_STUB_SCRIPT; every invocation appends one line to
// KANBAN_STUB_LOG ({ argv, cwd }).
import fs from "node:fs";

const argv = process.argv.slice(2);
const logPath = process.env.KANBAN_STUB_LOG;
const scriptPath = process.env.KANBAN_STUB_SCRIPT;
const script = scriptPath ? JSON.parse(fs.readFileSync(scriptPath, "utf8")) : {};
if (logPath) fs.appendFileSync(logPath, JSON.stringify({ argv, cwd: process.cwd() }) + "\\n");

const out = (text) => fs.writeSync(1, text + "\\n");

if (argv.length === 1 && argv[0] === "--protocol") {
  out(String(script.protocol ?? 1));
  process.exit(script.protocolExit ?? 0);
}

if (argv[0] === "kanban" && argv[1] === "status" && argv[2] === "--json") {
  const mode = script.mode;
  if (mode === "view") { out(JSON.stringify(script.view)); process.exit(0); }
  if (mode === "no-state") {
    out('{"schema":"specstride.inspect.status/1","cmd":"status","ok":false,"reason":"no-state","fix":"run the engine once, or pass --feature to name the run"}');
    process.exit(1);
  }
  if (mode === "no-feature") {
    out('{"schema":"specstride.inspect.status/1","cmd":"status","ok":false,"reason":"no-feature","fix":"pass --feature with the slug of the feature"}');
    process.exit(1);
  }
  if (mode === "exit70") process.exit(70);
  if (mode === "junk") { out("this is not json at all {{{"); process.exit(0); }
  if (mode === "big") { out("x".repeat(600 * 1024)); process.exit(0); }
  process.exit(0);
}

fs.writeSync(2, "stub shim: refused argv " + JSON.stringify(argv) + "\\n");
process.exit(3);
`;

/** Write the stub peer files (idempotent; safe to call from every test). */
export function ensureStubPeer(): string {
  mkdirSync(dirname(stubShimPath), { recursive: true });
  writeFileSync(stubShimPath, STUB_SHIM, "utf8");
  writeFileSync(
    join(stubPeerRoot, "package.json"),
    JSON.stringify({ name: "@specstride/host-dsh", version: "0.0.0", private: true, type: "module" }, null, 2) + "\n",
    "utf8",
  );
  return stubShimPath;
}

export type StubCall = { argv: string[]; cwd: string };

export function readLog(path: string): StubCall[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as StubCall);
}
