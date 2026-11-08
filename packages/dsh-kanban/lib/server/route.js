/**
 * T040 (contracts/view-route.md "Request"; F121-FR-004, F121-FR-007,
 * F121-FR-015, F121-FR-017) — the route handler. The checks run in the
 * contract's order, and every refusal answers before any CLI call:
 * method → path → token → session/cursor → busy → run binding → workspace.
 * `GET ?session=` → workspace → `status --json`/`wait --until-change` →
 * acceptance → `view` | `unchanged` | `no-run` | `refused-schema` |
 * `unavailable` | `run-changed`, always JSON with the hardening headers.
 */
import { resolveWorkspace, SESSION_ID_PATTERN,              } from "./workspace.js";
import { status, wait,                                    } from "./cli.js";
import { readerCursor, readWorkspaceView } from "./workspace-view.js";
import { refusalLine } from "../shared/view-read.js";
import { TOKEN_HEADER,                } from "./token.js";

export const VIEW_PATH = "/specstride/view";
export const UNAVAILABLE_LINE = "Kanban unavailable — run /specstride-doctor";
/** contracts/view-route.md check 4: the cursor the client sends back. */
export const CURSOR_PATTERN = /^[0-9]+\.[0-9]+\.[0-9a-f]{8}$/;

const HEADERS                                   = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'",
  "X-Content-Type-Options": "nosniff",
  "Content-Type": "application/json; charset=utf-8",
};

                                                                                                                 

function reply(status        , body                         )        {
  return { status, body, headers: HEADERS };
}

function mapResult(result                           )        {
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
export async function answerSession(ctx         , sessionId        , cursor                )                 {
  const resolved = await resolveWorkspace(ctx, sessionId);
  if (!resolved.ok) return reply(200, { answer: "no-run" }); // resolution failure: 0 CLI calls (F121-FR-007)
  // With a cursor the cycle is the blocking wait, then at most one status (F121-FR-004).
  const engine = cursor ? await wait(resolved.cwd, cursor) : await status(resolved.cwd);
  if (engine.kind !== "unavailable") return mapResult(engine);
  // No engine answers (none on PATH, or one without a mounted `status`): read
  // the workspace's own files instead of leaving the tab "unavailable".
  return mapResult(fromWorkspace(resolved.cwd, cursor ?? null));
}

/** The workspace reader as a StatusResult/WaitResult; any read error is "unavailable". */
export function fromWorkspace(cwd        , cursor               )                            {
  try {
    const view = readWorkspaceView(cwd);
    // Nothing to show from the files either: keep the engine's "unavailable"
    // (it names the doctor), as before the reader existed.
    if (view.state === "none") return { kind: "unavailable" };
    const token = readerCursor(view);
    if (cursor !== null && cursor === token) return { kind: "unchanged", cursorToken: token };
    return { kind: "view", view, cursorToken: token };
  } catch {
    return { kind: "unavailable" };
  }
}

                                                                                                             

/**
 * Case-insensitive header read: the host's `node:http` request lowercases
 * every header name; the fake contexts of the tests may not (settled against
 * the real dsh, T049).
 */
function headerValue(request            , name        )                     {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(request.headers ?? {})) {
    if (key.toLowerCase() !== lower) continue;
    if (typeof value === "string") return value;
    if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  }
  return undefined;
}

/** The route handler: the contract's check order, then the session query. */
export function createViewHandler(ctx         , gate            )                                          {
  return async (request) => {
    // 1. Method (T-39: GET only).
    if ((request.method ?? "GET").toUpperCase() !== "GET") {
      return { status: 405, body: { answer: "method-not-allowed" }, headers: { ...HEADERS, Allow: "GET" } };
    }
    // 2. Path (the exact route guarantees it; checked again). The host's
    //    `node:http` request url is the relative request target — a base is
    //    required to parse it (settled against the real dsh, T049).
    const url = new URL(request.url ?? VIEW_PATH, "http://127.0.0.1");
    if (url.pathname !== VIEW_PATH) return reply(404, { answer: "bad-request" });
    // 3. Token (T-41: admitted, live, never evicted) — before anything else runs.
    const token = headerValue(request, TOKEN_HEADER);
    if (gate !== undefined && !gate.admit(token)) return reply(403, { answer: "forbidden" });
    // 4. The queries.
    const session = url.searchParams.get("session") ?? "";
    if (!SESSION_ID_PATTERN.test(session)) return reply(400, { answer: "bad-request" });
    const cursor = url.searchParams.get("cursor");
    if (cursor !== null && !CURSOR_PATTERN.test(cursor)) return reply(400, { answer: "bad-request" });
    if (gate === undefined) return answerSession(ctx, session, cursor);

    // One CLI call per token at a time (F121-FR-018).
    const live = token          ;
    if (!gate.claim(live)) return reply(429, { answer: "bad-request" });
    try {
      const result = await answerSession(ctx, session, cursor);
      if (result.body.answer === "view") {
        const runId = (result.body.view                       )?.runId;
        if (typeof runId !== "string") return result; // a view without a run id is not a run to bind
        if (gate.bind(live, runId) === "run-changed") return reply(409, { answer: "run-changed" });
        gate.keepNewest(live, result.body.view); // the only view state kept per page (F121-FR-018)
      }
      return result;
    } finally {
      gate.release(live);
    }
  };
}
