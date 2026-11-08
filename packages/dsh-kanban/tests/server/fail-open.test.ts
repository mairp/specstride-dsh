/**
 * T041 — PT-121-002 (F121-FR-002, F121-SC-004): the fail-open behaviour.
 *
 * Server half: the built `lib/server/entry.js` with an `index.js` whose import
 * throws, and one whose `start` throws — `apply` resolves normally, logs
 * exactly one line `specstride-kanban: server half unavailable: <error name>`,
 * and registers nothing; the success path logs one `server half started`
 * line. `src/server/entry.ts` imports only `node:` built-ins at top level
 * (a static check).
 *
 * Client half: with no `specstride-view-token` meta in the document the pane
 * shows `Kanban unavailable — run /specstride-doctor` in one line and calls
 * `fetch` 0 times; with a meta present and a 200 `text/html` answer (the SPA
 * fallback, HF-26) it shows the same line and does not retry.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { afterEach, beforeEach } from "node:test";
import clientFactory from "../../src/client/index.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const entrySource = join(packageRoot, "src", "server", "entry.ts");
const builtEntry = join(packageRoot, "lib", "server", "entry.js");

let errorLines: string[];
let realConsoleError: typeof console.error | undefined;

function captureConsole(): void {
  realConsoleError = console.error;
  errorLines = [];
  console.error = (line: unknown) => {
    errorLines.push(String(line));
  };
}

beforeEach(captureConsole);

afterEach(() => {
  console.error = realConsoleError!;
});

/** A scratch dir with the built entry and one `index.js` given as source text. */
async function entryWith(indexSource: string): Promise<{ apply: (ctx: unknown, config?: unknown) => Promise<void> }> {
  assert.ok(existsSync(builtEntry), `lib/server/entry.js is missing — run the build (npm run build) first`);
  const dir = join(mkdtempSync(join(tmpdir(), "kanban-entry-")), "server");
  mkdirSync(dir);
  writeFileSync(join(dir, "entry.js"), readFileSync(builtEntry, "utf8"));
  writeFileSync(join(dir, "index.js"), indexSource);
  return (await import(pathToFileURL(join(dir, "entry.js")).href)) as { apply: (ctx: unknown, config?: unknown) => Promise<void> };
}

function recordingCtx(): { ctx: Record<string, unknown>; registered: unknown[]; taps: unknown[] } {
  const registered: unknown[] = [];
  const taps: unknown[] = [];
  return {
    registered,
    taps,
    ctx: {
      webServer: {
        host: "127.0.0.1",
        register(route: unknown) {
          registered.push(route);
          return () => undefined;
        },
        tapIndex(tap: unknown) {
          taps.push(tap);
          return () => undefined;
        },
      },
    },
  };
}

test("apply with an index.js whose import throws resolves, logs one line and registers nothing", async () => {
  const mod = await entryWith(`throw new Error("boom at import");\n`);
  const { ctx, registered, taps } = recordingCtx();
  await assert.doesNotReject(mod.apply(ctx));
  assert.deepEqual(errorLines, ["specstride-kanban: server half unavailable: Error"]);
  assert.equal(registered.length, 0, "no route was registered");
  assert.equal(taps.length, 0, "no index tap was registered");
});

test("apply with a start that throws resolves, logs one line naming the error and registers nothing", async () => {
  const mod = await entryWith(`export function start() { throw new RangeError("boom at start"); }\n`);
  const { ctx, registered, taps } = recordingCtx();
  await assert.doesNotReject(mod.apply(ctx));
  assert.deepEqual(errorLines, ["specstride-kanban: server half unavailable: RangeError"]);
  assert.equal(registered.length, 0);
  assert.equal(taps.length, 0);
});

test("apply on the success path calls start once and logs one started line", async () => {
  const started: unknown[] = [];
  const mod = await entryWith(`export function start(ctx) { started.push(ctx); return { started: true }; }\n`);
  const { ctx } = recordingCtx();
  (globalThis as Record<string, unknown>).started = started;
  try {
    await mod.apply(ctx);
  } finally {
    delete (globalThis as Record<string, unknown>).started;
  }
  assert.equal(started.length, 1);
  assert.equal(started[0], ctx);
  assert.equal(errorLines.length, 1);
  assert.match(errorLines[0]!, /^specstride-kanban: server half started /);
});

test("src/server/entry.ts imports only node: built-ins at top level", () => {
  const source = readFileSync(entrySource, "utf8");
  const imports = [...source.matchAll(/^import\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["'];?$/gm)].map((m) => m[1]!);
  assert.ok(imports.length > 0, "the entry has static imports");
  for (const specifier of imports) {
    assert.match(specifier, /^node:/, `top-level import "${specifier}" is not a node: built-in`);
  }
});

/* ------------------------------ the client half ------------------------------ */

let realFetch: typeof fetch | undefined;
let requests: { url: string; init?: RequestInit }[];

type Doc = { createElement: (tag: string) => Record<string, unknown>; querySelector?: (selector: string) => { getAttribute: (name: string) => string | null } | null };

function fakeCtx(doc: Doc): Record<string, unknown> {
  const appended: unknown[] = [];
  const container = {
    ownerDocument: doc,
    appendChild(child: unknown) {
      appended.push(child);
    },
  };
  (fakeCtx as unknown as { appended: unknown[] }).appended = appended;
  return {
    locale: "en-US",
    slots: {
      inject() {
        return () => undefined;
      },
    },
    layout() {
      return {
        mount() {
          return container;
        },
        unmount() {
          return undefined;
        },
      };
    },
    timer: {
      setTimeout() {
        return Symbol("timer");
      },
      clearTimeout() {
        return undefined;
      },
    },
  };
}

function metaDoc(content: string | null): Doc {
  return {
    createElement: () => {
      const attributes: Record<string, string> = {};
      return { attributes, setAttribute: (name: string, value: string) => { attributes[name] = value; } };
    },
    querySelector: (selector: string) => {
      assert.equal(selector, `meta[name="specstride-view-token"]`);
      return content === null ? null : { getAttribute: (name: string) => (name === "content" ? content : null) };
    },
  };
}

beforeEach(() => {
  requests = [];
  realFetch = globalThis.fetch;
  (globalThis as { fetch: unknown }).fetch = (async (url: unknown, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    return { json: async () => ({ answer: "view", view: {} }) };
  }) as typeof fetch;
});

afterEach(() => {
  (globalThis as { fetch: unknown }).fetch = realFetch!;
});

function appendedLines(): string[] {
  const appended = (fakeCtx as unknown as { appended?: unknown[] }).appended ?? [];
  return appended
    .filter((node) => (node as { attributes?: Record<string, string> }).attributes?.["data-kanban-style"] === undefined)
    .map((node) => (node as { textContent?: string }).textContent ?? "");
}

test("the client with no specstride-view-token meta shows the unavailable line and calls fetch 0 times", async () => {
  const app = clientFactory(fakeCtx(metaDoc(null)) as never);
  const inject = (app.registration as { inject: (sessionId: string) => unknown }).inject;
  const pane = inject("sess-1") as { dispose: () => void };
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(appendedLines(), ["Kanban unavailable — run /specstride-doctor"], "exactly one unavailable line");
  assert.equal(requests.length, 0, "no request was made");
  pane.dispose();
  app.dispose();
});

test("the client with a meta and a 200 text/html answer shows the unavailable line and does not retry", async () => {
  (globalThis as { fetch: unknown }).fetch = (async (url: unknown, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    return {
      status: 200,
      headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null) },
      json: async () => {
        throw new Error("json() on an html answer");
      },
    };
  }) as typeof fetch;
  const app = clientFactory(fakeCtx(metaDoc("A".repeat(43))) as never);
  const inject = (app.registration as { inject: (sessionId: string) => unknown }).inject;
  const pane = inject("sess-2") as { dispose: () => void };
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.ok(appendedLines().includes("Kanban unavailable — run /specstride-doctor"), "the unavailable line was shown");
  assert.equal(requests.length, 1, "exactly one request was made — no retry after the html answer");
  pane.dispose();
  app.dispose();
});
