/**
 * T023 (contracts/view-route.md; F121-FR-004, F121-FR-007, F121-FR-015) — the
 * first route answers. The auth gate, token checks and fail-open land later
 * (US4/US5); this pass wires `GET ?session=` → workspace → `status --json` →
 * acceptance → `view` | `no-run` | `refused-schema` | `unavailable`, always as
 * JSON with the three hardening headers.
 */
import { resolveWorkspace, SESSION_ID_PATTERN, type HostCtx } from "./workspace.ts";
import { status, wait, type StatusResult, type WaitResult } from "./cli.ts";
import { refusalLine } from "../shared/view-read.ts";

export const VIEW_PATH = "/specstride/view";
export const UNAVAILABLE_LINE = "Kanban unavailable — run /specstride-doctor";
/** contracts/view-route.md check 4: the cursor the client sends back. */
export const CURSOR_PATTERN = /^[0-9]+\.[0-9]+\.[0-9a-f]{8}$/;

const HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'",
  "X-Content-Type-Options": "nosniff",
  "Content-Type": "application/json; charset=utf-8",
};

export type Reply = { status: number; body: Record<string, unknown>; headers: Readonly<Record<string, string>> };

function reply(status: number, body: Record<string, unknown>): Reply {
  return { status, body, headers: HEADERS };
}

function mapResult(result: StatusResult | WaitResult): Reply {
  switch (result.kind) {
    case "view":
      return reply(200, { answer: "view", view: result.view, cursor: { token: result.cursorToken } });
    case "unchanged":
      return reply(200, { answer: "unchanged", cursor: { token: result.cursorToken } });
    case "no-run":
      return reply(200, { answer: "no-run" });
    case "refused-schema":
      return reply(200, { answer: "refused-schema", line: refusalLine("specstride.view/2") });
    case "unavailable":
      return reply(200, { answer: "unavailable", line: UNAVAILABLE_LINE });
  }
}

/** The answer for one session query: workspace, then one CLI call, then the mapping. */
export async function answerSession(ctx: HostCtx, sessionId: string, cursor?: string | null): Promise<Reply> {
  const resolved = resolveWorkspace(ctx, sessionId);
  if (!resolved.ok) return reply(200, { answer: "no-run" }); // resolution failure: 0 CLI calls (F121-FR-007)
  // With a cursor the cycle is the blocking wait, then at most one status (F121-FR-004).
  return mapResult(cursor ? await wait(resolved.cwd, cursor) : await status(resolved.cwd));
}

type Requestish = { method?: string; url?: string };

/** The route handler: method, path, then the session and cursor queries. */
export function createViewHandler(ctx: HostCtx): (request: Requestish) => Promise<Reply> {
  return async (request) => {
    if ((request.method ?? "GET").toUpperCase() !== "GET") {
      return { status: 405, body: { answer: "method-not-allowed" }, headers: { ...HEADERS, Allow: "GET" } };
    }
    const url = new URL(request.url ?? `http://127.0.0.1${VIEW_PATH}`);
    if (url.pathname !== VIEW_PATH) return reply(404, { answer: "bad-request" });
    const session = url.searchParams.get("session") ?? "";
    if (!SESSION_ID_PATTERN.test(session)) return reply(400, { answer: "bad-request" });
    const cursor = url.searchParams.get("cursor");
    if (cursor !== null && !CURSOR_PATTERN.test(cursor)) return reply(400, { answer: "bad-request" });
    return answerSession(ctx, session, cursor);
  };
}
