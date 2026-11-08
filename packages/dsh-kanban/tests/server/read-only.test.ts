/**
 * T039 — PT-121-018 (F121-FR-018, F121-SC-003): the read-only guarantees of the
 * server half. Over a request mix that produces every answer kind, STUB_LOG
 * holds only argv of the closed set `kanban-cli-verbs` (`kanban status --json`,
 * `kanban wait --until-change --cursor <token> --timeout 25`) and the shim's own
 * `--protocol` probes (tagged probe: true here — the shim's check, F120-FR-012,
 * not a verb of the server half). A recursive listing with mtimes of the
 * workspace, `$DSH_HOME` and the plugin directory is unchanged after the run
 * (no file written). The gate keeps per token only `runId`, the newest view and
 * the busy flag. A hanging stub is killed at its limit and no child process of
 * the test remains (`ps` by process group); a stub that forks a grandchild
 * leaves none behind.
 *
 * This file installs its own shim (same log contract as the shared helper's),
 * because it needs `wait` modes and a grandchild-forking stub in one script.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach } from "node:test";
import { start } from "../../src/server/index.ts";
import { createTokenGate } from "../../src/server/token.ts";
import { wait } from "../../src/server/cli.ts";
import { ensureStubPeer, readLog, stubShimPath } from "./helpers/stub-peer.ts";
import { TOKEN_HEADER } from "../../src/server/token.ts";

const views = join(import.meta.dirname, "..", "fixtures", "views");
const view = JSON.parse(readFileSync(join(views, "one-feature-each-lane.json"), "utf8")) as { runId?: string };

const CURSOR = "1024.12.0a1b2c3d";
const WAIT_ARGV = ["kanban", "wait", "--until-change", "--cursor", CURSOR, "--timeout", "25"];
const STATUS_ARGV = ["kanban", "status", "--json"];

const READONLY_SHIM = `#!/usr/bin/env node
// T039 — the read-only stub peer shim. Same log contract as the helper's shim:
// one line { argv, cwd } per invocation. status --json by script.statusMode
// (view | no-state | schema2 | exit70); wait by script.waitMode
// (unchanged | hang | grandchild).
import fs from "node:fs";
import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
const logPath = process.env.KANBAN_STUB_LOG;
const scriptPath = process.env.KANBAN_STUB_SCRIPT;
const script = scriptPath ? JSON.parse(fs.readFileSync(scriptPath, "utf8")) : {};
if (logPath) fs.appendFileSync(logPath, JSON.stringify({ argv, cwd: process.cwd() }) + "\\n");

const out = (text) => fs.writeSync(1, text + "\\n");

if (argv.length === 1 && argv[0] === "--protocol") {
  out(String(script.protocol ?? 1));
  process.exit(0);
}

if (argv[0] === "kanban" && argv[1] === "status" && argv[2] === "--json") {
  const mode = script.statusMode;
  if (mode === "view") { out(JSON.stringify(script.view)); process.exit(0); }
  if (mode === "no-state") {
    out('{"schema":"specstride.inspect.status/1","cmd":"status","ok":false,"reason":"no-state","fix":"run the engine once"}');
    process.exit(1);
  }
  if (mode === "schema2") { out(JSON.stringify({ ...script.view, schema: "specstride.view/2" })); process.exit(0); }
  if (mode === "exit70") process.exit(70);
  process.exit(1);
}

if (argv[0] === "kanban" && argv[1] === "wait") {
  const mode = script.waitMode;
  if (mode === "unchanged") process.exit(0);
  if (mode === "changed") { out(script.line); process.exit(0); }
  if (mode === "grandchild") {
    // Fork a grandchild into this process group, make sure it exists, then exit
    // cleanly: whatever way the runner ends this call, no grandchild survives.
    const child = spawn(process.execPath, ["-e", "/*kanban-grandchild*/ setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    child.unref();
    const start = Date.now();
    while (Date.now() - start < 80) {} // give the fork the time to exist
    process.exit(0);
  }
  if (mode === "hang") {
    // Never exits on its own: the open interval keeps the loop alive until the
    // runner's hard limit kills the process group. Control falls out of this
    // block — which is why the refusal below is the ELSE of this branch, not
    // a statement that follows it (an exit here would defeat the hang).
    setInterval(() => {}, 1000);
  } else {
    fs.writeSync(2, "stub shim: refused argv " + JSON.stringify(argv) + "\\n");
    process.exit(3);
  }
} else {
  fs.writeSync(2, "stub shim: refused argv " + JSON.stringify(argv) + "\\n");
  process.exit(3);
}
`;

let work: string;
let home: string;
let log: string;

function stub(script: Record<string, unknown>): void {
  writeFileSync(join(work, "stub-script.json"), JSON.stringify({ protocol: 1, ...script }));
}

type Registered = { path: string; handler: (request: Record<string, unknown>) => Promise<{ status: number; body: Record<string, unknown> }> };
let registrations: Registered[];
let gate: ReturnType<typeof createTokenGate>;

/** Mint a token the way the page gets one: through the served index answer. */
function mint(): string {
  const index = registrations.find((entry) => entry.path === "/");
  if (index !== undefined) {
    const reply = index.handler({ url: "http://127.0.0.1/" }) as { body: string };
    return /content="([A-Za-z0-9_-]{43})"/.exec(reply.body)![1]!;
  }
  return gate.mint();
}

beforeEach(() => {
  ensureStubPeer();
  writeFileSync(stubShimPath, READONLY_SHIM, "utf8");
  work = mkdtempSync(join(tmpdir(), "kanban-t039-work-"));
  home = mkdtempSync(join(tmpdir(), "kanban-t039-home-"));
  process.env.DSH_HOME = home;
  log = join(mkdtempSync(join(tmpdir(), "kanban-t039-log-")), "stub-log.jsonl");
  process.env.KANBAN_STUB_LOG = log;
  process.env.KANBAN_STUB_SCRIPT = join(work, "stub-script.json");
  stub({ statusMode: "exit70" });
  registrations = [];
  gate = undefined as never;
  const started = start({
    sessions: new Map([["w", { header: { cwd: work } }]]),
    webServer: {
      host: "127.0.0.1",
      register: (route: Registered) => {
        registrations.push(route);
        return () => {};
      },
    },
  } as never);
  assert.equal(started.started, true);
  gate = started.gate!;
});

afterEach(() => {
  for (const dir of [work, home]) rmSync(dir, { recursive: true, force: true });
  delete process.env.KANBAN_STUB_LOG;
  delete process.env.KANBAN_STUB_SCRIPT;
  delete process.env.DSH_HOME;
});

/** One view request with a fresh token, answered over the registered route. */
async function ask(query = "session=w", token: string | null = mint()) {
  const handler = registrations.find((entry) => entry.path === "/specstride/view")!.handler;
  const headers: Record<string, string> = token === null ? {} : { [TOKEN_HEADER]: token };
  return handler({ method: "GET", url: `http://127.0.0.1/specstride/view?${query}`, headers });
}

/** The argv classes the closed set allows: the two verbs and the shim's own probe. */
function classify(argv: string[]): "probe" | "status" | "wait" | "other" {
  if (argv.length === 1 && argv[0] === "--protocol") return "probe";
  if (argv[1] === "status" && argv[2] === "--json" && argv.length === 3) return "status";
  if (argv[1] === "wait" && argv[2] === "--until-change" && argv[3] === "--cursor" && argv[5] === "--timeout" && argv[6] === "25") return "wait";
  return "other";
}

// --- every answer kind, and only closed-set verbs ----------------------------------

test("a request mix over every answer kind runs only the closed-set verbs and the shim's probes", async () => {
  const mix: { script: Record<string, unknown>; query: string; answer: string }[] = [
    { script: { statusMode: "view", view }, query: "session=w", answer: "view" },
    { script: { waitMode: "changed", line: `run=r cur=${CURSOR}`, statusMode: "view", view }, query: `session=w&cursor=${CURSOR}`, answer: "view" }, // wait changed → status
    { script: { waitMode: "unchanged" }, query: `session=w&cursor=${CURSOR}`, answer: "unchanged" },
    { script: { statusMode: "no-state" }, query: "session=w", answer: "no-run" },
    { script: { statusMode: "schema2", view }, query: "session=w", answer: "refused-schema" },
    { script: { statusMode: "exit70" }, query: "session=w", answer: "unavailable" },
  ];
  stub(mix[0]!.script);
  let i = 0;
  for (const step of mix) {
    stub(step.script);
    const reply = await ask(step.query);
    assert.equal(reply.body.answer, step.answer, `step ${i} (${step.answer})`);
    i += 1;
  }
  const calls = readLog(log);
  assert.ok(calls.length > 0, "the mix reached the CLI");
  const kinds = new Set(calls.map((call) => classify(call.argv)));
  assert.deepEqual([...kinds].sort(), ["probe", "status", "wait"], `unexpected argv classes: ${JSON.stringify(calls.map((c) => c.argv))}`);
});

test("refused requests cost 0 CLI calls", async () => {
  stub({ statusMode: "view", view });
  await ask("session=w", null); // no token
  await ask("session=w", "z".repeat(43)); // unknown token
  await ask("session=bad session!", gate.mint()); // bad session query
  await ask("session=w&cursor=nope", gate.mint()); // bad cursor
  assert.equal(readLog(log).length, 0);
});

// --- no file written ----------------------------------------------------------------

type Listing = Map<string, number>;

function listingOf(root: string): Listing {
  const listing: Listing = new Map();
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const rel = `${prefix}${entry.name}`;
      if (entry.isDirectory()) walk(path, `${rel}/`);
      else listing.set(rel, statSync(path).mtimeMs);
    }
  };
  walk(root, "");
  return listing;
}

test("no file is written: workspace, DSH_HOME and the plugin directory are byte-for-byte unchanged (mtime listing)", async () => {
  // One script serves every request of this test — the snapshots must bracket
  // only server-half activity, never a rewrite of the stub script itself.
  stub({ statusMode: "view", view, waitMode: "unchanged" });
  const pluginDir = join(import.meta.dirname, "..", "..");
  const before = [listingOf(work), listingOf(home), listingOf(pluginDir)];
  const answers = await Promise.all([
    ask("session=w"), // status --json → view
    ask(`session=w&cursor=${CURSOR}`), // wait --until-change → unchanged
    ask("session=absent"), // no workspace: no-run, 0 calls
    ask("session=w", null), // no token: 403, 0 calls
  ]);
  assert.ok(answers.every((reply) => typeof reply.body.answer === "string"));
  const after = [listingOf(work), listingOf(home), listingOf(pluginDir)];
  for (let i = 0; i < before.length; i += 1) {
    const a = before[i] as Listing;
    const b = after[i] as Listing;
    assert.deepEqual([...b.keys()].sort(), [...a.keys()].sort(), `tree ${i} changed`);
    for (const [rel, mtime] of a) assert.equal(b.get(rel), mtime, `tree ${i}: ${rel} was touched`);
  }
});

// --- the per-token state is exactly runId, newest view, busy -------------------------

test("the gate keeps per token only the token, runId, newest view and busy flag", async () => {
  stub({ statusMode: "view", view });
  const token = gate.mint();
  const reply = await ask("session=w", token);
  assert.equal(reply.body.answer, "view");
  const live = gate.live();
  const mine = live.find((entry) => entry.token === token)!;
  assert.ok(mine, "the token is still live");
  assert.deepEqual(Object.keys(mine).sort(), ["busy", "newest", "runId", "token"]);
  assert.equal(mine.runId, (view as { runId?: string }).runId ?? "run-0001");
  assert.equal(mine.newest, reply.body.view, "the newest view is the one just served");
  assert.equal(mine.busy, false);
});

// --- no process left behind -----------------------------------------------------------

function nodeProcesses(): { pid: string; args: string }[] {
  const { status, stdout } = spawnSync("ps", ["-eo", "pid,args"], { encoding: "utf8" });
  if (status !== 0) return [];
  // The stub is invoked as `node <stubShimPath> ...`; the full per-process path
  // is the marker — a trimmed `bin/specstride.mjs` would also match unrelated
  // processes whose arguments quote that path (as the harness's own do).
  const stubMarker = stubShimPath;
  return String(stdout)
    .split("\n")
    .slice(1)
    .map((line) => ({ pid: line.trim().split(/\s+/)[0] ?? "", args: line }))
    .filter((entry) => entry.args.includes(stubMarker) && !/ps -eo/.test(entry.args));
}

test("a hanging stub is killed at its limit and no child process of the test remains", { timeout: 90_000 }, async () => {
  stub({ waitMode: "hang" });
  const start_ = Date.now();
  const result = await wait(work, CURSOR);
  assert.deepEqual(result, { kind: "unavailable" });
  assert.ok(Date.now() - start_ >= 24_000, "the hanging wait was killed too early");
  await new Promise((resolve) => setTimeout(resolve, 300)); // let the kill land
  assert.deepEqual(nodeProcesses(), [], "a stub process survived the kill");
});

test("a stub that forks a grandchild leaves none behind", async () => {
  stub({ waitMode: "grandchild" });
  const reply = await ask(`session=w&cursor=${CURSOR}`);
  assert.equal(reply.body.answer, "unchanged");
  // the grandchild carries the /*kanban-grandchild*/ marker in its ps args
  let survivors: unknown[] = [];
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    survivors = nodeProcesses().filter((entry) => entry.args.includes("kanban-grandchild"));
    if (survivors.length === 0) break;
  }
  assert.deepEqual(survivors, [], "a grandchild forked by the stub survived the group kill");
});
