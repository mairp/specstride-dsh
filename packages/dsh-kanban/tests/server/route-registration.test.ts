/**
 * T036 — PT-121-015 (F121-FR-015; HF-20): the route registration, on a fake
 * `ctx.webServer`. Exactly one `register` with path `/specstride/view` and kind
 * `exact`, outside `/plugins` and `/api`; no `registerUpgrade`, no
 * `registerFallback`; one `tapIndex`. A POST, PUT, DELETE and HEAD answer 405
 * with `Allow: GET` and leave 0 lines in STUB_LOG; the disposers run on unload.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "node:test";
import { start } from "../../src/server/index.ts";
import { VIEW_PATH } from "../../src/server/route.ts";
import { ensureStubPeer, readLog } from "./helpers/stub-peer.ts";

type Recorded = Record<string, unknown>;
type Disposer = () => void;

/** The fake cordis context: a webServer that records every touch, and an unload that runs the disposers. */
function fakeCtx(): {
  ctx: Record<string, unknown>;
  webServer: Record<string, unknown> & { host: string };
  registered: Recorded[];
  taps: unknown[];
  upgrades: unknown[];
  fallbacks: unknown[];
  unload: () => void;
  ran: string[];
} {
  const registered: Recorded[] = [];
  const taps: unknown[] = [];
  const upgrades: unknown[] = [];
  const fallbacks: unknown[] = [];
  const ran: string[] = [];
  const disposers: { name: string; dispose: Disposer }[] = [];
  const webServer = {
    host: "127.0.0.1",
    register(route: Recorded): Disposer {
      registered.push(route);
      const dispose = () => ran.push("register");
      disposers.push({ name: "register", dispose });
      return dispose;
    },
    tapIndex(tap: unknown): Disposer {
      taps.push(tap);
      const dispose = () => ran.push("tapIndex");
      disposers.push({ name: "tapIndex", dispose });
      return dispose;
    },
    registerUpgrade(handler: unknown): Disposer {
      upgrades.push(handler);
      return () => ran.push("registerUpgrade");
    },
    registerFallback(handler: unknown): Disposer {
      fallbacks.push(handler);
      return () => ran.push("registerFallback");
    },
  };
  const ctx: Record<string, unknown> = { webServer };
  const unload = () => {
    for (const { dispose } of disposers) dispose();
    disposers.length = 0;
  };
  return { ctx, webServer, registered, taps, upgrades, fallbacks, unload, ran };
}

let work: string;
let log: string;

beforeEach(() => {
  ensureStubPeer();
  work = mkdtempSync(join(tmpdir(), "kanban-t036-"));
  log = join(work, "stub-log.jsonl");
  process.env.KANBAN_STUB_LOG = log;
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
  delete process.env.KANBAN_STUB_LOG;
});

test("exactly one register: /specstride/view, exact, outside /plugins and /api", () => {
  const fake = fakeCtx();
  const result = start(fake.ctx as never);
  assert.equal(result.started, true, "the start refused a web server on 127.0.0.1");
  assert.equal(fake.registered.length, 1, `register was called ${fake.registered.length} times`);
  const route = fake.registered[0]!;
  assert.equal(route.path, VIEW_PATH);
  assert.equal(route.path, "/specstride/view");
  assert.equal(route.kind, "exact");
  assert.ok(!route.path.startsWith("/plugins"), "the route sits under /plugins");
  assert.ok(!route.path.startsWith("/api"), "the route sits under /api");
  assert.equal(typeof route.handler, "function", "the route carries no handler");
});

test("no registerUpgrade, no registerFallback, exactly one tapIndex", () => {
  const fake = fakeCtx();
  start(fake.ctx as never);
  assert.equal(fake.upgrades.length, 0, "registerUpgrade was called");
  assert.equal(fake.fallbacks.length, 0, "registerFallback was called");
  assert.equal(fake.taps.length, 1, `tapIndex was called ${fake.taps.length} times`);
  assert.equal(typeof fake.taps[0], "function", "the tap is not a function");
});

for (const method of ["POST", "PUT", "DELETE", "HEAD"]) {
  test(`${method} answers 405 with Allow: GET and 0 lines in STUB_LOG`, async () => {
    const fake = fakeCtx();
    const result = start(fake.ctx as never);
    assert.equal(result.started, true);
    const route = fake.registered[0]!;
    const handler = route.handler as (request: { method: string; url: string }) => Promise<{
      status: number;
      headers: Record<string, string>;
    }>;
    const reply = await handler({ method, url: `http://127.0.0.1${VIEW_PATH}?session=t036` });
    assert.equal(reply.status, 405, `${method} did not answer 405`);
    assert.equal(reply.headers.Allow, "GET", `${method} answered without Allow: GET`);
    assert.deepEqual(readLog(log), [], `${method} left CLI calls in STUB_LOG`);
  });
}

test("the disposers run on unload", () => {
  const fake = fakeCtx();
  const result = start(fake.ctx as never);
  assert.equal(fake.ran.length, 0, "a disposer ran before unload");
  fake.unload();
  assert.ok(fake.ran.includes("register"), "the register disposer did not run on unload");
  assert.ok(fake.ran.includes("tapIndex"), "the tapIndex disposer did not run on unload");
  if (typeof result.dispose === "function") {
    result.dispose();
    assert.ok(fake.ran.includes("register"), "the returned dispose is not the register disposer");
  }
});
