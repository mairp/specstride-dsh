/**
 * T018 — PT-121-003 (F121-FR-003; HF-17): the tab registration, against a
 * STRICT cordis-style ctx: any `ctx.<prop>` outside the plugin's exported
 * `inject` (and the cordis core `effect`) throws `cannot get property "<p>"
 * without inject`, as `vendor/cordis/src/reflect.ts` does in dsh rc.8.
 * `apply` makes exactly one `slots.inject("conversation.view", factory)`; the
 * factory registers `{ name, id, order: 20, locale: NS, label, inject }` with a
 * component; `label()` is the translated string; `inject(sessionId)` gives the
 * view its session; the pane passes the id to the poller as the session query
 * parameter; the module defines no `window` property and no `localStorage` key;
 * unmount aborts the one outstanding request, clears its timer and removes
 * `<style data-kanban-style>`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach } from "node:test";
import { apply, inject as clientInject, NS, openPane } from "../../src/client/index.ts";

const clientRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "client");
const view = JSON.parse(
  readFileSync(join(clientRoot, "..", "..", "tests", "fixtures", "views", "one-feature-each-lane.json"), "utf8"),
);

let injectCalls: { name: string; factory: () => unknown }[];
let registered: { registration: Record<string, unknown>; component: unknown }[];
let dictionaries: { ns: string; dicts: Record<string, Record<string, string>> }[];
let styleElements: { removed: boolean }[];
let appended: unknown[];
let timers: { fn: () => void; ms: number; handle: symbol }[];
let cleared: unknown[];
let requests: { url: string; init?: { signal?: AbortSignal } }[];
let container: Record<string, unknown>;
let realFetch: typeof fetch | undefined;

/** A ctx that behaves like the cordis proxy: undeclared services throw. */
function strictCtx(): Record<string, unknown> {
  const services: Record<string, unknown> = {
    slots: {
      inject(name: string, factory: () => unknown) {
        injectCalls.push({ name, factory });
        return factory();
      },
      register(registration: Record<string, unknown>, component: unknown) {
        registered.push({ registration, component });
        return () => undefined;
      },
    },
    locale: {
      register(ns: string, dicts: Record<string, Record<string, string>>) {
        dictionaries.push({ ns, dicts });
        return () => undefined;
      },
      bind(ns: string) {
        return (key: string) => dictionaries.find((d) => d.ns === ns)?.dicts.en?.[key] ?? key;
      },
    },
    // Present on the real ctx, never declared: reading them must fail the test.
    layout: {},
    timer: {},
    theme: {},
  };
  const core: Record<string, unknown> = { effect: (body: () => unknown) => body() };
  return new Proxy({}, {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop in core) return core[prop];
      if (!clientInject.includes(prop)) throw new Error(`cannot get property "${prop}" without inject`);
      return services[prop];
    },
  });
}

const testTimers = {
  setTimeout(fn: () => void, ms: number) {
    const handle = Symbol("timer");
    timers.push({ fn, ms, handle });
    return handle;
  },
  clearTimeout(handle: unknown) {
    cleared.push(handle);
  },
};

beforeEach(() => {
  injectCalls = [];
  registered = [];
  dictionaries = [];
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

test("the plugin declares slots and locale, and apply reads nothing else from ctx", () => {
  assert.deepEqual([...clientInject].sort(), ["locale", "slots"]);
  assert.doesNotThrow(() => apply(strictCtx() as never, undefined, () => undefined));
});

test("apply makes exactly one slots.inject(\"conversation.view\", factory) that registers one entry with a component", () => {
  apply(strictCtx() as never, undefined, () => undefined);
  assert.equal(injectCalls.length, 1);
  assert.equal(injectCalls[0]!.name, "conversation.view");
  assert.equal(registered.length, 1);
  assert.equal(typeof registered[0]!.component, "function", "the entry carries a view component");
});

test("the registration is { name, id: \"kanban\", order: 20, locale: NS, label } with label() the translated string", () => {
  apply(strictCtx() as never, undefined, () => undefined);
  const registration = registered[0]!.registration;
  assert.equal(registration.name, "conversation.view");
  assert.equal(registration.id, "kanban");
  assert.equal(registration.order, 20);
  assert.equal(registration.locale, NS);
  assert.equal(dictionaries.length, 1);
  assert.equal(dictionaries[0]!.ns, NS);
  assert.equal((registration.label as () => string)(), "Kanban");
  assert.deepEqual((registration.inject as (sessionId: string) => unknown)("sess-42"), { sessionId: "sess-42" });
});

test("the pane passes the session id to the poller as the session query parameter", async () => {
  const pane = openPane({ container }, "sess-42", () => undefined, testTimers);
  assert.equal(requests.length, 1);
  const url = new URL(requests[0]!.url, "http://127.0.0.1");
  assert.equal(url.pathname, "/specstride/view");
  assert.equal(url.searchParams.get("session"), "sess-42");
  assert.ok(requests[0]!.init?.signal !== undefined, "the request carries an abort signal");
  await new Promise((resolve) => setTimeout(resolve, 10));
  pane.dispose();
});

test("the module defines no window property and no localStorage key", async () => {
  const sources = ["index.ts", "react-adapter.ts"].map((name) => readFileSync(join(clientRoot, name), "utf8")).join("\n");
  assert.doesNotMatch(sources, /\bwindow\s*\./, "the client sources never touch window");
  assert.doesNotMatch(sources, /\blocalStorage\b/, "the client sources never touch localStorage");
  apply(strictCtx() as never, undefined, () => undefined);
  assert.equal((globalThis as Record<string, unknown>).localStorage, undefined);
  assert.equal(
    Object.getOwnPropertyNames(globalThis).filter((name) => /kanban/i.test(name)).length,
    0,
  );
});

test("unmount aborts the outstanding request, clears the timer and removes the style tag", async () => {
  const pane = openPane({ container }, "sess-7", () => undefined, testTimers);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const signal = requests[0]!.init?.signal;
  assert.equal(appended.length, 1, "one <style data-kanban-style> was appended");
  assert.equal((styleElements[0] as unknown as { attributes: Record<string, string> }).attributes["data-kanban-style"], "");
  pane.dispose();
  assert.equal(signal?.aborted, true, "the outstanding request was aborted");
  assert.equal(cleared.length, 1, "the poll timer was cleared");
  assert.equal(styleElements[0]!.removed, true, "the style tag was removed");
  assert.equal(requests.length, 1, "no further request was scheduled after unmount");
});

test("a poll that keeps answering unavailable rewrites ONE status line instead of stacking new ones", async () => {
  (globalThis as { fetch: unknown }).fetch = (async (url: unknown, init?: { signal?: AbortSignal }) => {
    requests.push({ url: String(url), init });
    return { json: async () => ({ answer: "unavailable", line: "Kanban unavailable — run /specstride-doctor" }) };
  }) as typeof fetch;
  const pane = openPane({ container }, "sess-9", () => undefined, testTimers);
  for (let tick = 0; tick < 4; tick += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    const due = timers.shift();
    if (due !== undefined) due.fn();
  }
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(requests.length >= 3, `the poller kept polling (${requests.length} requests)`);
  const lines = appended.filter((node) => (node as { attributes?: Record<string, string> }).attributes?.["data-kanban-style"] === undefined);
  assert.equal(lines.length, 1, "exactly one status line in the pane");
  pane.dispose();
});
