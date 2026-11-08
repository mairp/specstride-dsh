/**
 * T038 — PT-121-017 (F121-FR-017, F121-SC-003; research.md R5): the view token.
 * The index tap adds exactly one `<meta name="specstride-view-token">` carrying a
 * fresh 43-character token per response; the view route answers 403 `forbidden`
 * with 0 CLI calls when the header is missing, unknown or evicted (the 65th
 * minted token evicts the oldest of 64); the first `view` binds the token to its
 * `runId`, and a later view of another run answers 409 `run-changed` and voids
 * the token; a second request on a busy token answers 429 without spawning the
 * CLI; the client half, on `run-changed`, refetches `/` with `cache: "no-store"`,
 * reads the new meta token and never shows cards of two runs; the token
 * comparison is constant time (`timingSafeEqual`).
 *
 * The tested surface (contracts, US4/US5):
 * - `src/server/token.ts` exports `TOKEN_HEADER = "specstride-view-token"`,
 *   `TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/`, `TOKEN_CAPACITY = 64` and
 *   `createTokenGate()` → `{ mint, admit, claim, release, bind, voidToken }`
 *   (`mint()` hands out fresh tokens FIFO-capped at `TOKEN_CAPACITY`;
 *   `admit(token)` is false for missing/unknown/evicted tokens; `claim`/`release`
 *   guard one in-flight request per token; `bind(token, runId)` binds on the
 *   first `view` and answers `"run-changed"` — voiding the token — on another
 *   run's view).
 * - `start()` registers, next to the view route, an index tap at path `/` whose
 *   handler takes `{ url }` and returns `{ status, headers, body }` with the meta
 *   in `body`; `createViewHandler(ctx)` reads `request.headers[TOKEN_HEADER]`.
 * - The poller attaches the header `specstride-view-token` to every view fetch
 *   and, on `run-changed`, refetches `/` with `cache: "no-store"` and re-reads
 *   the meta out of the HTML.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { afterEach, beforeEach } from "node:test";
import { start } from "../../src/server/index.ts";
import type { HostCtx } from "../../src/server/workspace.ts";
import { TOKEN_CAPACITY, TOKEN_HEADER, TOKEN_PATTERN } from "../../src/server/token.ts";
import { startPoller } from "../../src/client/poller.ts";
import { ensureStubPeer, readLog } from "./helpers/stub-peer.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "views");
const viewFixture = JSON.parse(readFileSync(join(fixtures, "one-feature-each-lane.json"), "utf8")) as Record<string, unknown>;
const viewBFixture = JSON.parse(readFileSync(join(fixtures, "two-features-grouped.json"), "utf8")) as Record<string, unknown>;

/** Two views of two different runs: same shape, different `runId`. */
function viewOf(runId: string, base: Record<string, unknown> = viewFixture): Record<string, unknown> {
  return { ...structuredClone(base), runId };
}
const viewA = viewOf("run-0001");
const viewB = viewOf("run-0002", viewBFixture);

const META = /<meta\s+name="specstride-view-token"\s+content="([A-Za-z0-9_-]{43})"\s*\/?>/g;

// --- the harness -------------------------------------------------------------------

let work: string;
let log: string;

type Registered = { name: string; path: string; kind: string; handler: (request: Record<string, unknown>) => unknown };
let registrations: Registered[];

function fakeWebServer(): { host: string; register: (route: Registered) => unknown } {
  return {
    host: "127.0.0.1",
    register(route: Registered) {
      registrations.push(route);
      return () => {};
    },
  };
}

function handlerAt(path: string): Registered["handler"] {
  const route = registrations.find((entry) => entry.path === path);
  assert.ok(route, `a route for ${path} was registered`);
  return route.handler;
}

type Reply = { status: number; body: unknown; headers: Readonly<Record<string, string>> };

function viewRequest(token: string | null, session = "w"): { url: string; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  if (token !== null) headers[TOKEN_HEADER] = token;
  return { url: `http://127.0.0.1/specstride/view?session=${session}`, headers };
}

/** One index tap: the fresh meta token of the answer. */
async function mint(): Promise<string> {
  const reply = (await handlerAt("/")( { url: "http://127.0.0.1/" } )) as Reply;
  assert.equal(reply.status, 200);
  const html = String(reply.body);
  META.lastIndex = 0;
  const metas = [...html.matchAll(META)];
  assert.equal(metas.length, 1, "the index answer carries exactly one specstride-view-token meta");
  const token = metas[0]![1]!;
  assert.match(token, TOKEN_PATTERN);
  return token;
}

function stub(mode: string, extra: Record<string, unknown> = {}): void {
  writeFileSync(join(work, "stub-script.json"), JSON.stringify({ protocol: 1, mode, ...extra }));
}

beforeEach(() => {
  ensureStubPeer();
  work = mkdtempSync(join(tmpdir(), "kanban-t038-"));
  log = join(work, "stub-log.jsonl");
  process.env.KANBAN_STUB_LOG = log;
  process.env.KANBAN_STUB_SCRIPT = join(work, "stub-script.json");
  registrations = [];
  const ctx: HostCtx & { webServer: unknown } = {
    sessions: new Map([["w", { header: { cwd: work } }]]),
    webServer: fakeWebServer(),
  };
  const started = start(ctx);
  assert.equal(started.started, true);
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
  delete process.env.KANBAN_STUB_LOG;
  delete process.env.KANBAN_STUB_SCRIPT;
});

// --- the index tap -----------------------------------------------------------------

test("the index tap adds exactly one specstride-view-token meta with a fresh 43-character token per response", async () => {
  const first = await mint();
  const second = await mint();
  assert.notEqual(first, second, "every response mints a fresh token");
  assert.equal(first.length, 43);
  assert.equal(second.length, 43);
});

// --- 403: missing, unknown and evicted tokens cost 0 CLI calls ---------------------

for (const [label, token] of [
  ["no header at all", null],
  ["an unknown token", "z".repeat(43)],
  ["a non-conforming token", "too-short"],
] as const) {
  test(`a request with ${label} answers 403 forbidden with 0 CLI calls`, async () => {
    stub("view", { view: viewA });
    const reply = (await handlerAt("/specstride/view")(viewRequest(token))) as Reply;
    assert.equal(reply.status, 403);
    assert.equal((reply.body as Record<string, unknown>).answer, "forbidden");
    assert.equal(readLog(log).length, 0);
  });
}

test("the evicted token — the 1st of 64, once the 65th is minted — answers 403 with 0 CLI calls", async () => {
  stub("view", { view: viewA });
  const tokens: string[] = [];
  for (let i = 0; i < TOKEN_CAPACITY + 1; i += 1) tokens.push(await mint());
  assert.equal(tokens.length, TOKEN_CAPACITY + 1);
  assert.equal(new Set(tokens).size, tokens.length, "every minted token is fresh");

  const evicted = (await handlerAt("/specstride/view")(viewRequest(tokens[0]))) as Reply;
  assert.equal(evicted.status, 403);
  assert.equal((evicted.body as Record<string, unknown>).answer, "forbidden");
  assert.equal(readLog(log).length, 0, "an evicted token never reaches the CLI");

  const fresh = (await handlerAt("/specstride/view")(viewRequest(tokens[TOKEN_CAPACITY]))) as Reply;
  assert.equal(fresh.status, 200, "the newest token of the window is still admitted");
});

// --- the run binding ---------------------------------------------------------------

test("the first view binds the token to its runId", async () => {
  stub("view", { view: viewA });
  const token = await mint();
  const reply = (await handlerAt("/specstride/view")(viewRequest(token))) as Reply;
  assert.equal(reply.status, 200);
  assert.equal((reply.body as Record<string, unknown>).answer, "view");
  assert.equal(readLog(log).length, 2);

  // the same token against the same run is fine: it is admitted, not 403/409
  stub("view", { view: viewA });
  const again = (await handlerAt("/specstride/view")(viewRequest(token))) as Reply;
  assert.equal(again.status, 200);
});

test("a later view of another run answers 409 run-changed and voids the token", async () => {
  stub("view", { view: viewA });
  const token = await mint();
  const first = (await handlerAt("/specstride/view")(viewRequest(token))) as Reply;
  assert.equal(first.status, 200);

  stub("view", { view: viewB });
  const changed = (await handlerAt("/specstride/view")(viewRequest(token))) as Reply;
  assert.equal(changed.status, 409);
  assert.equal((changed.body as Record<string, unknown>).answer, "run-changed");
  assert.equal(readLog(log).length, 4);

  // the token is void: even the original run is refused now, with 0 CLI calls
  stub("view", { view: viewA });
  const voided = (await handlerAt("/specstride/view")(viewRequest(token))) as Reply;
  assert.equal(voided.status, 403);
  assert.equal(readLog(log).length, 4);
});

// --- the busy guard ----------------------------------------------------------------

test("a second request on a busy token answers 429 without a CLI call", async () => {
  stub("view", { view: viewA });
  const token = await mint();
  const view = handlerAt("/specstride/view");
  const first = view(viewRequest(token)) as Promise<Reply>; // in flight over the stub spawn
  const second = (await view(viewRequest(token))) as Reply;
  assert.equal(second.status, 429);
  const settled = await first;
  assert.equal(settled.status, 200);
  // only the first request reached the CLI: --protocol + status --json
  assert.equal(readLog(log).length, 2);
});

// --- constant-time comparison ------------------------------------------------------

test("the token comparison uses timingSafeEqual", () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "server", "token.ts"),
    "utf8",
  );
  assert.match(source, /timingSafeEqual/);
  // sanity: the helper this test reads is the real one
  assert.ok(timingSafeEqual(Buffer.alloc(32), Buffer.alloc(32)));
});

// --- the client half ---------------------------------------------------------------

type Answer =
  | { answer: "view"; view: Record<string, unknown>; cursor?: { token?: string } }
  | { answer: "unchanged"; cursor?: { token?: string } }
  | { answer: "run-changed" };

type RecordedFetch = { url: string; init: { signal: AbortSignal; cache?: string; headers?: Record<string, string> } };

/** A poller over a scripted fetch; returns the fetch log and the rendered views. */
function harness(script: Answer[], indexHtml: () => string) {
  const renders: Record<string, unknown>[] = [];
  const requests: RecordedFetch[] = [];
  let step = 0;
  const timers = {
    // Real macrotask timers with the delay clamped to 2 ms: the whole script
    // (view, run-changed, new view) plays out inside the test's 20 ms wait,
    // and every poll yields to the event loop, so this test's own timer and
    // the process finish. (Microtask timers starve the event loop: the wait
    // and the runner's finalisation never run.)
    setTimeout(fn: () => void, ms: number) {
      return setTimeout(fn, Math.min(ms, 2));
    },
    clearTimeout(timer: ReturnType<typeof setTimeout>) {
      clearTimeout(timer);
    },
  };
  const fetch = (url: string, init: { signal: AbortSignal; cache?: string; headers?: Record<string, string> }) => {
    requests.push({ url, init });
    if (url === "/") {
      return Promise.resolve({ text: () => Promise.resolve(indexHtml()) });
    }
    const answer = script[Math.min(step, script.length - 1)]!;
    step += 1;
    return Promise.resolve({ json: () => Promise.resolve(answer) });
  };
  const poller = startPoller({
    sessionId: "w",
    timers: timers as never,
    fetch: fetch as never,
    render: (view) => renders.push(view),
    stale: () => {},
  });
  return { renders, requests, poller };
}

test("on run-changed the client refetches / with cache no-store, reads the new meta and never shows cards of two runs", async () => {
  const token1 = await mint();
  const token2 = await mint();
  assert.notEqual(token1, token2);
  const { renders, requests, poller } = harness(
    [
      { answer: "view", view: viewA, cursor: { token: "1024.12.0a1b2c3d" } },
      { answer: "run-changed" },
      { answer: "view", view: viewB, cursor: { token: "1024.13.0b2c3d4e" } },
    ],
    () =>
      `<!doctype html><html><head><meta name="specstride-view-token" content="${token2}"></head>` +
      `<body>board</body></html>`,
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  poller.dispose(); // the poll cadence must not outlive the test

  const index = requests.find((request) => request.url === "/");
  assert.ok(index, "the client refetched / after run-changed");
  assert.equal(index.init.cache, "no-store");
  // the view request after the refetch carries the fresh meta token, not the voided one
  const indexAt = requests.indexOf(index);
  const after = requests[indexAt + 1];
  assert.ok(after, "the poll continues after the refetch");
  assert.equal(after.init.headers?.[TOKEN_HEADER], token2);
  assert.notEqual(after.init.headers?.[TOKEN_HEADER], token1);

  // only whole views of one run each were rendered — never a merge of two runs
  assert.ok(renders.length >= 2);
  const runIds = renders.map((render) => render.runId);
  assert.deepEqual([...new Set(runIds)].sort(), ["run-0001", "run-0002"]);
  assert.equal(renders[renders.length - 1], viewB, "the last render is exactly the new run's view");
  for (const render of renders) {
    assert.ok(render === viewA || render === viewB, "every render is one run's whole view");
  }
});
