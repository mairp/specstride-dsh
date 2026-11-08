/**
 * T040 (data-model §5; F121-FR-017, F121-FR-018; research.md R5) — the view
 * token store. One token per index response; the map holds TOKEN_CAPACITY
 * tokens, the oldest evicted; a token binds to one run id on its first `view`
 * and is voided by a view of another run. Comparison is `timingSafeEqual`.
 * The per-token record keeps only `runId` and `newest` (plus the busy flag that
 * enforces one CLI call per token at a time) — the only per-page state
 * F121-FR-018 allows. Everything lives in memory; nothing is written.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";

export const TOKEN_HEADER = "specstride-view-token";
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const TOKEN_CAPACITY = 64;

/** The order of a token inside the FIFO: minted first, evicted first. */
type StoredToken = {
  /** 32 bytes of randomBytes, base64url — 43 characters. */
  bytes: Buffer;
  /** null until the first `view`; then fixed (F121-FR-017). */
  runId: string | null;
  /** The last accepted view, or null. The newest state of the page. */
  newest: unknown;
  /** One CLI call per token at a time; a second request answers 429. */
  busy: boolean;
};

export type TokenGate = {
  /** A fresh token, minted per index response; may evict the oldest. */
  mint: () => string;
  /** True only for a live (present, non-void) token; constant-time compare. */
  admit: (token: string | undefined) => boolean;
  /** Mark the token busy; false when a request on it is already in flight. */
  claim: (token: string) => boolean;
  /** The in-flight request is over. */
  release: (token: string) => void;
  /** Bind on the first `view`; `"run-changed"` (token voided) on another run. */
  bind: (token: string, runId: string) => "ok" | "run-changed";
  /** Drop the token (also the release path of `bind`'s run change). */
  voidToken: (token: string) => void;
  /** The newest view held for the token, or null. */
  newestOf: (token: string) => unknown;
  /** Record the newest view of the token (the only view state kept). */
  keepNewest: (token: string, view: unknown) => void;
  /** Live tokens, oldest first — what the read-only test inspects. */
  live: () => { token: string; runId: string | null; newest: unknown; busy: boolean }[];
};

/** A token string must be well-formed before any comparison. */
function conforms(token: string | undefined): token is string {
  return typeof token === "string" && TOKEN_PATTERN.test(token);
}

export function createTokenGate(): TokenGate {
  /** Insertion-ordered: the oldest token is the map's first entry. */
  const tokens = new Map<string, StoredToken>();

  function recordOf(token: string): StoredToken | undefined {
    if (!conforms(token)) return undefined;
    const record = tokens.get(token);
    if (record === undefined) return undefined;
    if (!timingSafeEqual(record.bytes, Buffer.from(token, "base64url"))) return undefined;
    return record;
  }

  return {
    mint() {
      if (tokens.size >= TOKEN_CAPACITY) {
        const oldest = tokens.keys().next().value;
        if (oldest !== undefined) tokens.delete(oldest);
      }
      const bytes = randomBytes(32);
      const token = bytes.toString("base64url");
      tokens.set(token, { bytes, runId: null, newest: null, busy: false });
      return token;
    },

    admit(token) {
      return recordOf(token) !== undefined;
    },

    claim(token) {
      const record = recordOf(token);
      if (record === undefined || record.busy) return false;
      record.busy = true;
      return true;
    },

    release(token) {
      const record = recordOf(token);
      if (record !== undefined) record.busy = false;
    },

    bind(token, runId) {
      const record = recordOf(token);
      if (record === undefined) return "run-changed";
      if (record.runId === null) {
        record.runId = runId; // the first view fixes the run (F121-FR-017)
        return "ok";
      }
      if (record.runId === runId) return "ok";
      this.voidToken(token); // a different run voids the token outright
      return "run-changed";
    },

    voidToken(token) {
      tokens.delete(token);
    },

    newestOf(token) {
      return recordOf(token)?.newest ?? null;
    },

    keepNewest(token, view) {
      const record = recordOf(token);
      if (record !== undefined) record.newest = view;
    },

    live() {
      return [...tokens.entries()].map(([token, record]) => ({
        token,
        runId: record.runId,
        newest: record.newest,
        busy: record.busy,
      }));
    },
  };
}

/** The meta element the index tap injects (one per response). */
export function tokenMeta(token: string): string {
  return `<meta name="${TOKEN_HEADER}" content="${token}">`;
}

/** The threshold meta rides on the same tap (research.md R9, HF-22). */
export const THRESHOLD_META_NAME = "specstride-view-threshold";

export function thresholdMeta(threshold: number): string {
  return `<meta name="${THRESHOLD_META_NAME}" content="${String(threshold)}">`;
}
