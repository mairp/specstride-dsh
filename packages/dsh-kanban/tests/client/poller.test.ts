/**
 * T025 — PT-121-010 (F121-FR-010, F121-FR-003): the poller, tested against the
 * answer table of contracts/view-route.md ("What the client does"), row by row,
 * with a fake `fetch` and fake timers: `view` re-renders from the new view
 * only; `unchanged` does not re-render; `unavailable`, a network error and the
 * client limit (35 s) keep the last view and add the banner
 * "Not updated since <time>" with the time of the last good view; the backoff
 * runs 1, 2, 4 … 30 s and resets on success; at every instant at most one
 * request is outstanding (asserted on every fake-fetch call); two pollers (two
 * browser tabs) hold two cursors and neither consumes the other's change.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach } from "node:test";
import { openPane, POLL_MS } from "../../src/client/index.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "views");
const viewA = JSON.parse(readFileSync(join(fixtures, "one-feature-each-lane.json"), "utf8")) as Record<string, unknown>;
const viewB = JSON.parse(readFileSync(join(fixtures, "two-features-grouped.json"), "utf8")) as Record<string, unknown>;

type Scripted =
  | { answer: "view"; view: Record<string, unknown>; token?: string }
  | { answer: "unchanged"; token?: string }
  | { answer: "unavailable"; line?: string }
  | { answer: "no-run" }
  | { answer: "refused-schema"; line?: string }
  | { error: Error }
  | { hang: true };

type Element = { type: unknown; props: Record<string, unknown>; children: unknown[] };

/** The client limit (contracts/view-route.md): no answer may be awaited past 35 s. */
const CLIENT_LIMIT_MS = 35_000;
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

// --- the fake clock (fake timers) -------------------------------------------------

type Pending = { fn: () => void; at: number; handle: symbol };

class Clock {
  now = 0;
  private pending: Pending[] = [];

  setTimeout(fn: () => void, ms: number): unknown {
    const handle = Symbol("timer");
    this.pending.push({ fn, at: this.now + ms, handle });
    return handle;
  }

  clearTimeout(handle: unknown): void {
    this.pending = this.pending.filter((timer) => timer.handle !== handle);
  }

  /** The delay of the single scheduled poll timer. */
  nextDelay(): number | undefined {
    const next = this.pending.slice().sort((a, b) => a.at - b.at)[0];
    return next === undefined ? undefined : next.at - this.now;
  }

  /** How many timers are currently scheduled. */
  count(): number {
    return this.pending.length;
  }

  /** Fire every timer due within `ms`, in order, draining microtasks between them. */
  async advance(ms: number): Promise<void> {
    const target = this.now + ms;
    for (;;) {
      const due = this.pending.filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      this.pending = this.pending.filter((timer) => timer.handle !== due.handle);
      this.now = due.at;
      due.fn();
      await drain();
    }
    this.now = target;
  }
}

async function drain(): Promise<void> {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
}

/** Enough microtask turns for a whole fetch → json → render chain to finish. */
async function settle(): Promise<void> {
  await drain();
  await drain();
  await drain();
}

// --- the fake fetch ---------------------------------------------------------------

type Recorded = { url: URL; init?: { signal?: AbortSignal } };
let requests: Recorded[] = [];
// the one-outstanding invariant is per poller, so it is tracked per session
const inflight = new Map<string, number>();

function outstandingOf(session: string | null): number {
  return inflight.get(session ?? "?") ?? 0;
}

function assertAtMostOneOutstanding(): void {
  for (const [session, count] of inflight) {
    assert.ok(count <= 1, `at most one outstanding request per poller (session ${session} had ${count})`);
  }
}
let answerFor: (url: URL, index: number) => Scripted = () => ({ answer: "no-run" });
let realFetch: typeof fetch | undefined;

function installFakeFetch(): void {
  realFetch = globalThis.fetch;
  let index = 0;
  (globalThis as { fetch: unknown }).fetch = (async (url: unknown, init?: { signal?: AbortSignal }) => {
    // asserted on every fake-fetch call: at most one request outstanding at every instant
    const session = new URL(String(url), "http://kanban.test").searchParams.get("session");
    assert.equal(outstandingOf(session), 0, "a second request was started while one was still outstanding");
    inflight.set(session ?? "?", 1);
    const recorded = { url: new URL(String(url), "http://kanban.test"), init };
    requests.push(recorded);
    const scripted = answerFor(recorded.url, index);
    index += 1;
    if ("hang" in scripted) return new Promise(() => {}); // never settles; the client limit must reap it
    for (let i = 0; i < 3; i += 1) await Promise.resolve();
    inflight.set(session ?? "?", 0);
    if ("error" in scripted) throw scripted.error;
    const body =
      scripted.answer === "view"
        ? { answer: "view", view: scripted.view, ...(scripted.token === undefined ? {} : { cursor: { token: scripted.token } }) }
        : scripted.answer === "unchanged"
          ? { answer: "unchanged", ...(scripted.token === undefined ? {} : { cursor: { token: scripted.token } }) }
          : scripted.answer === "unavailable"
            ? { answer: "unavailable", line: scripted.line ?? "Kanban unavailable — run /specstride-doctor" }
            : scripted.answer === "refused-schema"
              ? { answer: "refused-schema", line: scripted.line ?? "refused" }
              : { answer: scripted.answer };
    return { ok: true, status: 200, json: async () => body };
  }) as typeof fetch;
}

// --- the fake react (to capture every render) --------------------------------------

function fakeReact() {
  return {
    createElement(type: unknown, props: Record<string, unknown>, ...children: unknown[]): Element {
      return { type, props, children };
    },
  };
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const element = value as Partial<Element> & { props?: Record<string, unknown> };
  const own = Object.values(element.props ?? {})
    .filter((prop): prop is string => typeof prop === "string")
    .join(" ");
  const kids = Array.isArray(element.children) ? element.children.map(textOf).join(" ") : "";
  return `${own} ${kids}`.trim();
}

// --- the pane host -----------------------------------------------------------------

type Pane = { dispose: () => void };
let updates: Element[];
let container: Record<string, unknown>;

function open(clock: Clock, sessionId: string): Pane {
  return openPane(
    { container, update: (element) => updates.push(element as Element) },
    sessionId,
    () => fakeReact(),
    clock,
  );
}

/** Everything the pane has ever shown, renders and DOM children alike. */
function rendered(): string {
  const children = (container as { __texts: string[] }).__texts ?? [];
  return `${children.join(" ")} ${updates.map(textOf).join(" ")}`.trim();
}

beforeEach(() => {
  requests = [];
  inflight.clear();
  updates = [];
  container = {
    ownerDocument: {
      createElement(tag: string) {
        return {
          tag,
          attributes: {} as Record<string, string>,
          removed: false,
          setAttribute(name: string, value: string) {
            (this as unknown as { attributes: Record<string, string> }).attributes[name] = value;
          },
          remove() {
            (this as unknown as { removed: boolean }).removed = true;
          },
          parentNode: null,
          __text: "",
          get textContent() {
            return (this as unknown as { __text: string }).__text;
          },
          set textContent(value: string) {
            (this as unknown as { __text: string }).__text = value;
          },
        };
      },
    },
    appendChild(child: unknown) {
      const texts = (container as { __texts?: string[] }).__texts ?? ((container as { __texts: string[] }).__texts = []);
      const text = (child as { textContent?: string })?.textContent;
      if (typeof text === "string") texts.push(text);
      texts.push("");
    },
  };
  answerFor = () => ({ answer: "no-run" });
  installFakeFetch();
});

afterEach(() => {
  (globalThis as { fetch: unknown }).fetch = realFetch;
  inflight.clear();
});

function lastGoodTimeAround(): { before: string; after: string } {
  return { before: new Date(Date.now() - 5).toISOString(), after: new Date(Date.now() + 5).toISOString() };
}

function assertBanner(time: { before: string; after: string }): void {
  const shown = rendered();
  const match = /Not updated since (\S+)/.exec(shown);
  assert.ok(match !== null, `the banner "Not updated since <time>" is missing from the render: ${shown.slice(0, 200)}`);
  const stamp = Date.parse(match[1]!);
  assert.ok(!Number.isNaN(stamp), `the banner time ${match[1]} must be a timestamp`);
  assert.ok(
    stamp >= Date.parse(time.before) - 50 && stamp <= Date.parse(time.after) + 50,
    `the banner time ${match[1]} must be the time of the last good view`,
  );
}

function cursorOf(url: URL): string | null {
  return url.searchParams.get("cursor");
}

// --- the answer table, row by row --------------------------------------------------

test("row `view`: re-renders from the new view only", async () => {
  let token = "t0";
  answerFor = () => {
    const current = token;
    token = "t1";
    return { answer: "view", view: current === "t0" ? viewA : viewB, token: current === "t0" ? "t1" : "t2" };
  };
  const clock = new Clock();
  const pane = open(clock, "sess-view");
  await settle();
  assert.equal(updates.length, 1, "the first `view` answer renders once");
  const first = textOf(updates[0]);
  assert.notEqual(first, "", "the render is not empty");
  await clock.advance(POLL_MS);
  assert.equal(updates.length, 2, "the second `view` answer renders again");
  const second = textOf(updates[1]!);
  assert.notEqual(second, first, "the second render comes from the new view");
  assert.ok(requests.length === 2, `exactly one request per poll cycle (saw ${requests.length})`);
  assert.equal(cursorOf(requests[1]!.url), "t1", "the poll carries the cursor token of the previous `view` answer");
  assert.ok(!/Not updated since/.test(rendered()), "a good `view` answer clears the staleness banner");
  pane.dispose();
});

test("row `unchanged`: does not re-render", async () => {
  let first = true;
  answerFor = () => (first ? ((first = false), { answer: "view", view: viewA, token: "t1" }) : { answer: "unchanged", token: "t1" });
  const clock = new Clock();
  const pane = open(clock, "sess-unchanged");
  await settle();
  assert.equal(updates.length, 1);
  await clock.advance(POLL_MS);
  await clock.advance(POLL_MS);
  assert.equal(updates.length, 1, "`unchanged` never re-renders");
  assert.equal(requests.length, 3, "the poll keeps its 5 s cadence on `unchanged`");
  for (const request of requests.slice(1)) {
    assert.equal(cursorOf(request.url), "t1", "`unchanged` keeps polling with the held cursor");
  }
  assert.ok(!/Not updated since/.test(rendered()), "`unchanged` is a good answer: no banner");
  pane.dispose();
});

test("row `unavailable`: keeps the last view and adds the banner \"Not updated since <time>\"", async () => {
  let polls = 0;
  answerFor = () => {
    polls += 1;
    return polls === 1 ? { answer: "view", view: viewA, token: "t1" } : { answer: "unavailable" };
  };
  const clock = new Clock();
  const pane = open(clock, "sess-unavail");
  await settle();
  const good = lastGoodTimeAround();
  assert.equal(updates.length, 1);
  await clock.advance(POLL_MS);
  assert.equal(updates.length, 1, "`unavailable` does not re-render the board");
  assert.ok(textOf(updates[0]).length > 0, "the last view is kept");
  assertBanner(good);
  // the backoff polls still answer `unavailable`; the last view stays
  await clock.advance(BACKOFF_MS[0]!);
  assert.equal(updates.length, 1, "still no re-render while unavailable");
  assertBanner(good);
  pane.dispose();
});

test("a network error is the `unavailable` row: keep the last view, add the banner", async () => {
  let first = true;
  answerFor = () =>
    first
      ? ((first = false), { answer: "view", view: viewA, token: "t1" })
      : { error: new TypeError("fetch failed") };
  const clock = new Clock();
  const pane = open(clock, "sess-neterr");
  await settle();
  const good = lastGoodTimeAround();
  await clock.advance(POLL_MS);
  assert.equal(updates.length, 1, "a network error never re-renders");
  assertBanner(good);
  pane.dispose();
});

test("the client limit (35 s): a hanging answer is reaped, the last view and the banner stay", async () => {
  let first = true;
  answerFor = () =>
    first ? ((first = false), { answer: "view", view: viewA, token: "t1" }) : { hang: true };
  const clock = new Clock();
  const pane = open(clock, "sess-limit");
  await settle();
  const good = lastGoodTimeAround();
  await clock.advance(POLL_MS + CLIENT_LIMIT_MS);
  // the hanging request is the second one; its signal is the one the limit must abort
  const held = requests[requests.length - 1]!.init?.signal;
  assert.notEqual(held, undefined, "the hanging request was sent with an AbortSignal");
  assert.equal(updates.length, 1, "the client limit keeps the last view");
  assertBanner(good);
  assert.equal(held?.aborted, true, "the outstanding request is aborted at the client limit");
  assertAtMostOneOutstanding();
  pane.dispose();
  assert.ok(requests.length >= 2, "polling continues after the client limit");
});

// --- the backoff --------------------------------------------------------------------

test("the backoff runs 1, 2, 4 s after failures and resets to the 5 s cadence on success", async () => {
  let polls = 0;
  answerFor = () => {
    polls += 1;
    if (polls === 1) return { answer: "view", view: viewA, token: "t1" };
    if (polls <= 4) return { answer: "unavailable" };
    return { answer: "unchanged", token: "t1" };
  };
  const clock = new Clock();
  const pane = open(clock, "sess-backoff");
  await settle();
  const delays: (number | undefined)[] = [];
  for (let i = 0; i < 4; i += 1) {
    const delay = clock.nextDelay();
    delays.push(delay);
    await clock.advance(delay ?? 0);
  }
  assert.deepEqual(delays.slice(0, 4), [POLL_MS, 1_000, 2_000, 4_000], `the backoff is 1, 2, 4 … s after failures (saw ${delays})`);
  assert.equal(clock.nextDelay(), POLL_MS, "a good answer resets the backoff to the 5 s cadence");
  pane.dispose();
});

test("the backoff is capped at 30 s and never grows past it", async () => {
  answerFor = () => ({ answer: "unavailable" });
  const clock = new Clock();
  const pane = open(clock, "sess-cap");
  await settle();
  const delays: (number | undefined)[] = [];
  for (let i = 0; i < 6; i += 1) {
    const delay = clock.nextDelay();
    delays.push(delay);
    await clock.advance(delay ?? 0);
  }
  assert.deepEqual(
    delays,
    [1_000, 2_000, 4_000, 8_000, 16_000, 30_000],
    `the backoff doubles 1, 2, 4 … and caps at 30 s (saw ${delays})`,
  );
  await clock.advance(BACKOFF_MS[BACKOFF_MS.length - 1]!);
  assert.equal(clock.nextDelay(), 30_000, "the backoff stays capped at 30 s");
  pane.dispose();
});

// --- the one-outstanding-request invariant -------------------------------------------

test("at every instant at most one request is outstanding", async () => {
  let polls = 0;
  answerFor = () => {
    polls += 1;
    if (polls % 2 === 0) return { error: new Error("boom") };
    return { answer: "view", view: polls === 1 ? viewA : viewB, token: `t${polls}` };
  };
  const clock = new Clock();
  const pane = open(clock, "sess-single");
  await settle();
  for (let i = 0; i < 6; i += 1) {
    await clock.advance(POLL_MS + i * 1_000);
    assertAtMostOneOutstanding();
    assert.ok(clock.count() <= 1, "exactly one poll timer is scheduled at a time");
  }
  const count = requests.length;
  pane.dispose();
  await settle();
  assert.equal(requests.length, count, "disposing stops the poller for good");
});

// --- two pollers, two cursors ---------------------------------------------------------

test("two pollers (two browser tabs) hold two cursors and neither consumes the other's change", async () => {
  // tab A moves forward to viewB with cursor tA2; tab B stays on its own cursor and
  // only ever sees `unchanged` — neither tab's cursor advances the other's.
  answerFor = (url) => {
    const session = url.searchParams.get("session");
    const cursor = cursorOf(url);
    if (session === "tab-a") {
      return cursor === null ? { answer: "view", view: viewA, token: "tA1" } : { answer: "view", view: viewB, token: "tA2" };
    }
    return cursor === null ? { answer: "view", view: viewA, token: "tB1" } : { answer: "unchanged", token: "tB1" };
  };
  const clock = new Clock();
  const tabA = open(clock, "tab-a");
  const tabB = open(clock, "tab-b");
  await settle();
  assert.equal(updates.length, 2, "each tab rendered its own first view");
  await clock.advance(POLL_MS);
  assert.equal(cursorOf(requests[2]!.url), "tA1", "tab A polls with its own cursor");
  assert.equal(cursorOf(requests[3]!.url), "tB1", "tab B polls with its own cursor");
  assert.equal(requests[2]!.url.searchParams.get("session"), "tab-a");
  assert.equal(requests[3]!.url.searchParams.get("session"), "tab-b");
  await clock.advance(POLL_MS);
  assert.equal(cursorOf(requests[4]!.url), "tA2", "tab A advanced to its new cursor after its `view`");
  assert.equal(cursorOf(requests[5]!.url), "tB1", "tab B still holds its own cursor: it never consumed tab A's change");
  assert.ok(!/Not updated since/.test(rendered()), "neither tab is stale");
  tabA.dispose();
  tabB.dispose();
  await settle();
  assert.equal(requests.length, 6, "disposing either tab stops only that tab's poller");
});
