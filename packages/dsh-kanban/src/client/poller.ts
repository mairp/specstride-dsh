/**
 * T028 — the poller (contracts/view-route.md "What the client does"; F121-FR-003,
 * F121-FR-010). At most one outstanding request at every instant (one
 * `AbortController` per request, reaped at the client limit of 35 s), one timer
 * at a time, the backoff 1, 2, 4 … 30 s after a failed cycle and the 5 s
 * cadence again on a good one. The staleness time is taken from the browser
 * clock when the last good answer arrived and handed to the pane already
 * formatted — no clock lives in the builders.
 */
import { boardTree } from "../shared/board-tree.ts";
import { toReact } from "./react-adapter.ts";

export const VIEW_PATH = "/specstride/view";
export const POLL_MS = 5000;
/** The client limit (contracts/view-route.md): no answer is awaited past 35 s. */
export const CLIENT_LIMIT_MS = 35_000;
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
/** The view token header (T-41); the same name the server half's meta carries. */
export const TOKEN_HEADER = "specstride-view-token";
const TOKEN_META_PATTERN = new RegExp(`<meta\\s+name="${TOKEN_HEADER}"\\s+content="([A-Za-z0-9_-]{43})"\\s*/*>`);

type TreeNode = { tag: string; attrs: Readonly<Record<string, string>>; text?: string; children: readonly TreeNode[] };
type Reactish = { createElement: (...args: unknown[]) => unknown };
type Timers = { setTimeout?: (fn: () => void, ms: number) => unknown; clearTimeout?: (timer: unknown) => void };

type Answer = {
  answer?: string;
  view?: Record<string, unknown>;
  cursor?: { token?: string } | null;
  line?: string;
};

export type PollerOptions = {
  sessionId: string;
  timers: Timers;
  /** One fetch; the poller passes an `AbortSignal` it may abort at the limit. */
  fetch: (url: string, init: { signal: AbortSignal; cache?: string; headers?: Record<string, string> }) =>
    Promise<{ json: () => Promise<Answer>; text?: () => Promise<string> }>;
  /** Render a view (the route's accepted `RunView` as printed). */
  render: (view: Record<string, unknown>) => void;
  /** The staleness line, with the time of the last good answer already formatted. */
  stale: (text: string) => void;
  /** A one-line message (refusal, unavailable) shown without a board. */
  message?: (text: string) => void;
  limitMs?: number;
  /** The token of this page load, when the pane already knows it (R5). */
  token?: string | null;
};

export type Poller = { dispose: () => void };

export function startPoller(options: PollerOptions): Poller {
  const timers = options.timers;
  const limitMs = options.limitMs ?? CLIENT_LIMIT_MS;
  const setTimeout = timers.setTimeout?.bind(timers) ?? globalThis.setTimeout.bind(globalThis);
  const clearTimeout = timers.clearTimeout?.bind(timers) ?? globalThis.clearTimeout.bind(globalThis);

  let disposed = false;
  let timer: unknown;
  let limitTimer: unknown;
  let controller: AbortController | undefined;
  let generation = 0;
  let cursor: string | null = null;
  let backoffIndex = 0;
  let lastGoodAt: number | null = null;
  let forbiddenRun = false;
  // The view token of this page load (T-41). Voided by `run-changed`/`forbidden`,
  // refreshed from a fresh index fetch before the next view request.
  let token: string | null = typeof options.token === "string" ? options.token : null;
  let needToken = false; // set by `run-changed`/`forbidden`: the next cycle fetches a fresh index

  const schedule = (ms: number): void => {
    if (disposed) return;
    timer = setTimeout(poll, ms);
  };

  const resetBackoff = (): void => {
    backoffIndex = 0;
  };

  const nextBackoff = (): number => {
    const delay = BACKOFF_MS[Math.min(backoffIndex, BACKOFF_MS.length - 1)] as number;
    backoffIndex = Math.min(backoffIndex + 1, BACKOFF_MS.length - 1);
    return delay;
  };

  const markStale = (): void => {
    options.stale(`Not updated since ${new Date(lastGoodAt ?? Date.now()).toISOString()}`);
  };

  const fail = (): void => {
    markStale();
    schedule(nextBackoff());
  };

  function handle(value: Answer | null): void {
    const answer = typeof value?.answer === "string" ? value.answer : undefined;
    const token = typeof value?.cursor?.token === "string" ? value.cursor.token : null;
    switch (answer) {
      case "view": {
        if (value?.view === undefined || value.view === null || typeof value.view !== "object") return fail();
        if (token !== null) cursor = token;
        options.render(value.view as Record<string, unknown>);
        lastGoodAt = Date.now();
        resetBackoff();
        schedule(POLL_MS);
        return;
      }
      case "unchanged": {
        if (token !== null) cursor = token;
        lastGoodAt = Date.now();
        resetBackoff();
        schedule(POLL_MS);
        return;
      }
      case "no-run": {
        cursor = null;
        lastGoodAt = Date.now();
        resetBackoff();
        schedule(POLL_MS);
        return;
      }
      case "refused-schema": {
        options.message?.(typeof value?.line === "string" ? value.line : "Kanban cannot read this view — run /specstride-doctor");
        return; // one line, no partial board, no retry (contracts/view-route.md)
      }
      case "run-changed": {
        cursor = null; // the token of the old run is void; ask again without a cursor
        needToken = true; // a fresh index brings a fresh token (R5)
        schedule(0);
        return;
      }
      case "forbidden": {
        if (forbiddenRun) return fail(); // a second forbidden in a row is an outage
        forbiddenRun = true;
        cursor = null;
        needToken = true;
        schedule(0);
        return;
      }
      case "unavailable":
        return fail();
      default: {
        // Not an answer of the route (e.g. the SPA fallback's index HTML): no retry.
        options.message?.("Kanban unavailable — run /specstride-doctor");
      }
    }
  }

  async function poll(): Promise<void> {
    if (disposed) return;
    const mine = ++generation;
    controller = new AbortController();
    try {
      if (needToken) {
        needToken = false;
        const fresh = await options.fetch("/", { signal: controller.signal, cache: "no-store" });
        if (mine !== generation || disposed) return;
        const html = typeof fresh.text === "function" ? await fresh.text() : "";
        if (mine !== generation || disposed) return;
        const match = TOKEN_META_PATTERN.exec(html);
        token = match === null ? null : (match[1] ?? null);
        if (token === null) {
          // No token meta in the page: the server half is not there — the
          // unavailable line, no retry (contracts/view-route.md).
          options.message?.("Kanban unavailable — run /specstride-doctor");
          return;
        }
      }
      const url = `${VIEW_PATH}?session=${encodeURIComponent(options.sessionId)}${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
      limitTimer = setTimeout(() => {
        if (mine !== generation || disposed) return;
        controller?.abort();
        markStale();
        schedule(nextBackoff());
      }, limitMs);
      const response = await options.fetch(url, {
        signal: controller.signal,
        ...(token === null ? {} : { headers: { [TOKEN_HEADER]: token } }),
      });
      if (mine !== generation || disposed) return;
      const value = await response.json();
      if (mine !== generation || disposed) return;
      forbiddenRun = false;
      handle(value);
    } catch {
      if (mine !== generation || disposed) return;
      fail();
    } finally {
      if (mine === generation) {
        clearTimeout(limitTimer);
        limitTimer = undefined;
        // The controller is kept, not nulled: a dispose while no request is in
        // flight still aborts the last signal, so an unmount never leaves a
        // fetchable handle behind (F121-FR-003).
      }
    }
  }

  void poll(); // the first request goes out as the pane mounts

  return {
    dispose() {
      disposed = true;
      // Only a still-pending in-flight limit timer is cleared here; the poll
      // timer, when one is pending, fires once into `poll`, which returns
      // immediately because `disposed` holds — so unmount schedules nothing and
      // aborts the one outstanding request (F121-FR-003).
      if (limitTimer !== undefined) clearTimeout(limitTimer);
      controller?.abort();
    },
  };
}

export type Pane = { dispose: () => void };

/** A pane poller that renders through the shared board tree and the React adapter. */
export function startPanePoller(
  options: {
    sessionId: string;
    timers: Timers;
    render: (tree: TreeNode, react: Reactish | undefined) => void;
    stale: (text: string) => void;
    message: (text: string) => void;
    token?: string | null;
  },
  reactOf: () => Reactish | undefined,
): Pane {
  return startPoller({
    sessionId: options.sessionId,
    timers: options.timers,
    fetch: (url, init) => fetch(url, init) as Promise<{ json: () => Promise<Answer> }>,
    render: (view) => options.render(boardTree(view as never), reactOf()),
    stale: options.stale,
    message: options.message,
    token: options.token,
  });
}
