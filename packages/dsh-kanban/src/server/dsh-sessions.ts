/**
 * Tokens, retries and live activity of the dsh calls of a feature, read from
 * dsh's own session records (`~/.dsh/sessions/<cwd-slug>/session-*\/session.jsonl.zstd`),
 * the one place a dsh-driven run records them: the engine's own `cost.log` and
 * `usage.*` events stay empty under dsh (F121-FR-023).
 *
 * A session counts for a feature when
 *  - it lives under the workspace's own slug and its first prompt reads
 *    "You are implementing phase N of the feature `<feature>`" (a proposer pass), or
 *    starts with the accelerator's framing and names a phase of the feature; or
 *  - it lives under a parallel worker root named after one of the feature's runs
 *    (attributed to the phase that run was in when the session began).
 * Critic and diagnostician calls run in anonymous temporary directories that name
 * no feature; they are not counted, and the view says so.
 *
 * Only counts, model names and times leave this module — never a prompt, a
 * reply, a tool argument or a path. Each session file is summarised once per
 * size (a bounded in-memory memo; the newest, growing session is the only one
 * read again on a poll).
 */
import { zstdDecompressSync } from "node:zlib";
import { join } from "node:path";

export type SessionFs = {
  list: (path: string) => string[];
  size: (path: string) => number;
  bytes: (path: string) => Uint8Array | null;
};

export type SessionSummary = {
  /** `proposer`, `accelerator` or `worker`; null when the session is not a Specstride call. */
  role: string | null;
  feature: string | null;
  phase: number | null;
  createdAt: number | null;
  lastAt: number | null;
  provider: string | null;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  calls: number;
  retries: number;
  rateLimited: number;
  backoffMs: number;
  steps: number;
  lastTool: string | null;
  runDir: string | null;
};

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd] as const;
/** A session file above this size is skipped (the largest seen is a few MB). */
const SESSION_CAP = 48 * 1024 * 1024;
const MEMO_CAP = 600;
const memo = new Map<string, { size: number; summary: SessionSummary }>();

/**
 * The text of a multi-frame zstd file. dsh appends one frame per flush, and
 * `zstdDecompressSync` stops at the end of the first frame, so every frame
 * start is decoded on its own; a magic number that is not a frame start fails
 * to decode and is skipped.
 */
export function decodeFrames(data: Uint8Array): string {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const parts: Buffer[] = [];
  let at = buf.indexOf(Buffer.from(ZSTD_MAGIC), 0);
  while (at >= 0) {
    try {
      parts.push(zstdDecompressSync(buf.subarray(at)));
    } catch {
      // not a frame start
    }
    at = buf.indexOf(Buffer.from(ZSTD_MAGIC), at + 4);
  }
  return Buffer.concat(parts).toString("utf8");
}

const PROPOSER = /^You are implementing phase (\d+) of the feature `([^`]+)`/;
const ACCELERATOR = /^<<<SPECSTRIDE-OUTSIDE-\d+>>>\s*#\s*Phase\s+(\d+)\b/;

/** One session's numbers (no content). */
export function summarise(text: string): SessionSummary {
  const s: SessionSummary = {
    role: null, feature: null, phase: null, createdAt: null, lastAt: null, provider: null, model: null,
    tokensIn: 0, tokensOut: 0, calls: 0, retries: 0, rateLimited: 0, backoffMs: 0, steps: 0, lastTool: null, runDir: null,
  };
  let firstUser = true;
  for (const line of text.split("\n")) {
    if (line === "") continue;
    let e: { type?: unknown; time?: unknown; createdAt?: unknown; data?: Record<string, unknown> };
    try {
      e = JSON.parse(line) as typeof e;
    } catch {
      continue;
    }
    const data = e.data ?? {};
    if (typeof e.time === "number") s.lastAt = e.time;
    switch (e.type) {
      case "session":
        if (typeof e.createdAt === "number") s.createdAt = e.createdAt;
        break;
      case "user/message": {
        if (!firstUser) break;
        firstUser = false;
        const content = Array.isArray(data.content) ? data.content : [];
        const first = content.find((c): c is { text: string } => typeof c === "object" && c !== null && typeof (c as { text?: unknown }).text === "string");
        const head = (first?.text ?? "").slice(0, 400);
        const p = PROPOSER.exec(head);
        const a = ACCELERATOR.exec(head);
        if (p !== null) {
          s.role = "proposer";
          s.phase = Number.parseInt(p[1] as string, 10);
          s.feature = p[2] as string;
        } else if (a !== null) {
          s.role = "accelerator";
          s.phase = Number.parseInt(a[1] as string, 10);
        }
        break;
      }
      case "request/context":
        if (typeof data.provider === "string") s.provider = data.provider;
        if (typeof data.model === "string") s.model = data.model;
        break;
      case "assistant/message": {
        const usage = data.usage as { inputTokens?: unknown; outputTokens?: unknown } | undefined;
        if (typeof usage?.inputTokens === "number") s.tokensIn += usage.inputTokens;
        if (typeof usage?.outputTokens === "number") s.tokensOut += usage.outputTokens;
        s.calls += 1;
        break;
      }
      case "llm/retry": {
        s.retries += 1;
        const failure = data.failure as { code?: unknown } | undefined;
        if (failure?.code === "RATE_LIMIT") s.rateLimited += 1;
        if (typeof data.delayMs === "number") s.backoffMs += data.delayMs;
        break;
      }
      case "step/start":
        s.steps += 1;
        break;
      case "tool/call": {
        const name = (data as { name?: unknown; tool?: unknown }).name ?? (data as { tool?: unknown }).tool;
        if (typeof name === "string" && /^[\w.:-]{1,40}$/.test(name)) s.lastTool = name;
        break;
      }
    }
  }
  return s;
}

function summaryOf(fs: SessionFs, path: string): SessionSummary | null {
  const size = fs.size(path);
  if (size === 0 || size > SESSION_CAP) return null;
  const known = memo.get(path);
  if (known !== undefined && known.size === size) return known.summary;
  const bytes = fs.bytes(path);
  if (bytes === null) return null;
  const summary = summarise(decodeFrames(bytes));
  if (memo.size >= MEMO_CAP) memo.delete(memo.keys().next().value as string);
  memo.set(path, { size, summary });
  return summary;
}

/** dsh's directory name for a working directory: every `/` becomes `-`, then `-` before and `--` after (`/root` → `--root--`). */
export function cwdSlug(cwd: string): string {
  return `-${cwd.replace(/\//g, "-")}--`;
}

/**
 * The Specstride sessions of one feature: proposer and accelerator passes in
 * the workspace's slug, and parallel workers under roots named after one of
 * `runIds`. `phaseAt(runId, ms)` attributes a worker to a phase.
 */
export function featureSessions(
  fs: SessionFs,
  sessionsRoot: string,
  cwd: string,
  feature: string,
  phaseTitles: ReadonlySet<number>,
  runIds: readonly string[],
  phaseAt: (runId: string, at: number | null) => number | null,
): SessionSummary[] {
  const out: SessionSummary[] = [];
  const own = join(sessionsRoot, cwdSlug(cwd));
  for (const name of fs.list(own)) {
    if (!/^session-[\w-]+$/.test(name)) continue;
    const s = summaryOf(fs, join(own, name, "session.jsonl.zstd"));
    if (s === null || s.role === null || s.phase === null) continue;
    if (s.role === "proposer" && s.feature !== feature) continue;
    if (!phaseTitles.has(s.phase)) continue;
    out.push({ ...s, feature });
  }
  if (runIds.length > 0) {
    for (const dir of fs.list(sessionsRoot)) {
      if (!dir.includes("specstride-parallel-")) continue;
      const runId = runIds.find((id) => dir.includes(id));
      if (runId === undefined) continue;
      for (const name of fs.list(join(sessionsRoot, dir))) {
        if (!/^session-[\w-]+$/.test(name)) continue;
        const s = summaryOf(fs, join(sessionsRoot, dir, name, "session.jsonl.zstd"));
        if (s === null) continue;
        const phase = phaseAt(runId, s.createdAt);
        if (phase === null) continue;
        out.push({ ...s, role: "worker", feature, phase, runDir: runId });
      }
    }
  }
  return out;
}

/** For tests: forget every memoised summary. */
export function forgetSessions(): void {
  memo.clear();
}
