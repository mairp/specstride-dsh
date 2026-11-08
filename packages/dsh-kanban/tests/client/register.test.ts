/**
 * T018 — PT-121-003 (F121-FR-003; HF-17): the tab registration. Materializing
 * the factory makes exactly one `inject("conversation.view", …)` whose
 * registration is `{ name, id, order: 20, locale, label, inject }` with `label()`
 * a string; `inject(sessionId)` passes the id to the poller as the session query
 * parameter; the module defines no `window` property and no `localStorage` key;
 * unmount aborts the one outstanding request, clears its timer, removes
 * `<style data-kanban-style>`, runs the layout unmount and the injection disposer.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach } from "node:test";
import clientFactory from "../../src/client/index.ts";

const clientRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "client");
const view = JSON.parse(
  readFileSync(join(clientRoot, "..", "..", "tests", "fixtures", "views", "one-feature-each-lane.json"), "utf8"),
);

let injectCalls: { name: string; registration: Record<string, unknown> }[];
let disposersRun: number;
let layoutCalls: Record<string, unknown>[];
let layoutUnmounts: number;
let styleElements: { removed: boolean }[];
let appended: unknown[];
let timers: { fn: () => void; ms: number; handle: symbol }[];
let cleared: unknown[];
let requests: { url: string; init?: { signal?: AbortSignal } }[];
let container: Record<string, unknown>;
let realFetch: typeof fetch | undefined;

function fakeCtx(): Record<string, unknown> {
  return {
    locale: "en-US",
    slots: {
      inject(name: string, registration: Record<string, unknown>) {
        injectCalls.push({ name, registration });
        return () => {
          disposersRun += 1;
        };
      },
    },
    layout(descriptor: Record<string, unknown>) {
      layoutCalls.push(descriptor);
      return {
        mount() {
          return container;
        },
        unmount() {
          layoutUnmounts += 1;
        },
      };
    },
    timer: {
      setTimeout(fn: () => void, ms: number) {
        const handle = Symbol("timer");
        timers.push({ fn, ms, handle });
        return handle;
      },
      clearTimeout(handle: unknown) {
        cleared.push(handle);
      },
    },
  };
}

beforeEach(() => {
  injectCalls = [];
  disposersRun = 0;
  layoutCalls = [];
  layoutUnmounts = 0;
  styleElements = [];
  appended = [];
  timers = [];
  cleared = [];
  requests = [];
  container = {
    ownerDocument: {
      createElement(tag: string) {
        const element: { tag: string; removed: boolean; attributes: Record<string, string>; setAttribute: (name: string, value: string) => void; remove: () => void } = {
          tag,
          removed: false,
          attributes: {},
          setAttribute(name: string, value: string) {
            element.attributes[name] = value;
          },
          remove() {
            element.removed = true;
          },
        };
        styleElements.push(element);
        return element;
      },
    },
    appendChild(child: unknown) {
      appended.push(child);
    },
  };
  realFetch = globalThis.fetch;
  (globalThis as { fetch: unknown }).fetch = (async (url: unknown, init?: { signal?: AbortSignal }) => {
    requests.push({ url: String(url), init });
    return { json: async () => ({ answer: "view", view }) };
  }) as typeof fetch;
});

afterEach(() => {
  (globalThis as { fetch: unknown }).fetch = realFetch;
});

test("materializing the factory makes exactly one inject(\"conversation.view\", …)", () => {
  const app = clientFactory(fakeCtx() as never);
  assert.equal(injectCalls.length, 1);
  assert.equal(injectCalls[0]!.name, "conversation.view");
  app.dispose();
});

test("the registration is { name, id: \"kanban\", order: 20, locale, label } with label() a string", () => {
  const app = clientFactory(fakeCtx());
  const registration = injectCalls[0]!.registration;
  assert.equal(registration.name, "conversation.view");
  assert.equal(registration.id, "kanban");
  assert.equal(registration.order, 20);
  assert.equal(registration.locale, "en-US");
  assert.equal(typeof registration.label, "function");
  assert.equal(typeof (registration.label as () => string)(), "string");
  assert.equal(typeof registration.inject, "function");
  app.dispose();
});

test("inject(sessionId) triggers the poller with the id as the session query parameter", async () => {
  const app = clientFactory(fakeCtx());
  const registration = injectCalls[0]!.registration;
  const pane = (registration.inject as (sessionId: string) => unknown)("sess-42");
  assert.equal(requests.length, 1);
  const url = new URL(requests[0]!.url, "http://127.0.0.1");
  assert.equal(url.pathname, "/specstride/view");
  assert.equal(url.searchParams.get("session"), "sess-42");
  assert.ok(requests[0]!.init?.signal !== undefined, "the request carries an abort signal");
  await new Promise((resolve) => setTimeout(resolve, 10));
  pane.dispose();
  app.dispose();
});

test("the module defines no window property and no localStorage key", async () => {
  const sources = ["index.ts", "react-adapter.ts"].map((name) => readFileSync(join(clientRoot, name), "utf8")).join("\n");
  assert.doesNotMatch(sources, /\bwindow\s*\./, "the client sources never touch window");
  assert.doesNotMatch(sources, /\blocalStorage\b/, "the client sources never touch localStorage");
  const app = clientFactory(fakeCtx());
  assert.equal((globalThis as Record<string, unknown>).localStorage, undefined);
  assert.equal(
    Object.getOwnPropertyNames(globalThis).filter((name) => /kanban/i.test(name)).length,
    0,
  );
  app.dispose();
});

test("unmount aborts the outstanding request, clears the timer, removes the style tag, unmounts the layout and runs the injection disposer", async () => {
  const app = clientFactory(fakeCtx());
  const pane = (injectCalls[0]!.registration.inject as (sessionId: string) => { dispose: () => void })("sess-7");
  await new Promise((resolve) => setTimeout(resolve, 10));
  const signal = requests[0]!.init?.signal;
  assert.equal(layoutCalls.length, 1);
  assert.equal(appended.length, 1, "one <style data-kanban-style> was appended");
  assert.equal((styleElements[0] as unknown as { attributes: Record<string, string> }).attributes["data-kanban-style"], "");
  pane.dispose();
  app.dispose();
  assert.equal(signal?.aborted, true, "the outstanding request was aborted");
  assert.equal(cleared.length, 1, "the poll timer was cleared");
  assert.equal(styleElements[0]!.removed, true, "the style tag was removed");
  assert.equal(layoutUnmounts, 1, "the layout unmount ran");
  assert.equal(disposersRun, 1, "the injection disposer ran");
  assert.equal(requests.length, 1, "no further request was scheduled after unmount");
});
