/**
 * T040 (contracts/view-route.md "Registration"; F121-FR-002, F121-FR-015,
 * F121-FR-016, F121-FR-017) — the module start. On the web profile it wires
 * exactly two things into the dsh web server: one exact GET route
 * `/specstride/view` and one index tap that injects the per-response view
 * token and the lane threshold meta. Both only when the host is 127.0.0.1
 * (T-40); any other host registers nothing and logs exactly one line. No
 * `registerUpgrade`, no `registerFallback`, ever.
 */
import { createTokenGate, THRESHOLD_META_NAME, thresholdMeta, tokenMeta, TOKEN_HEADER, type TokenGate } from "./token.ts";
import { createViewHandler, VIEW_PATH } from "./route.ts";
import type { HostCtx } from "./workspace.ts";

export type StartResult = { started: boolean; reason?: string; dispose?: () => void; gate?: TokenGate };

export const DEFAULT_LANE_THRESHOLD = 100;
export const LANE_THRESHOLD_MIN = 1;
export const LANE_THRESHOLD_MAX = 10_000;

/** The lane threshold from the patch row's `config`, or 100 with one line on an invalid value (research.md R9). */
export function laneThresholdOf(config: unknown, log: (line: string) => void): number {
  const value = (config as { laneThreshold?: unknown } | null)?.laneThreshold;
  if (value === undefined || value === null) return DEFAULT_LANE_THRESHOLD;
  if (typeof value !== "number" || !Number.isInteger(value) || value < LANE_THRESHOLD_MIN || value > LANE_THRESHOLD_MAX) {
    log(`specstride-kanban: invalid laneThreshold, using ${DEFAULT_LANE_THRESHOLD}`);
    return DEFAULT_LANE_THRESHOLD;
  }
  return value;
}

export type WebServerish = {
  host?: string;
  register?: (route: Record<string, unknown>) => unknown;
  tapIndex?: (tap: (html: unknown) => unknown) => unknown;
};

/** One log line per refusal; no run text ever reaches it (F121-FR-016). */
function logLine(line: string): void {
  console.error(line);
}

/**
 * The slice of `node:http` ServerResponse the route writes through: the host
 * hands the handler the raw pair and owns nothing of the body (settled by the
 * real-dsh lane, T049).
 */
export type Responder = {
  statusCode?: number;
  setHeader: (name: string, value: string) => unknown;
  end: (body: string) => unknown;
};

function writeReply(
  response: Responder,
  reply: { status: number; body: Record<string, unknown>; headers: Readonly<Record<string, string>> },
): void {
  response.statusCode = reply.status;
  for (const [name, value] of Object.entries(reply.headers)) response.setHeader(name, value);
  response.end(JSON.stringify(reply.body));
}

export function start(
  ctx: HostCtx & { webServer?: WebServerish; effect?: { add?: (dispose: () => void) => unknown } },
  config?: { laneThreshold?: unknown },
): StartResult {
  const webServer = ctx?.webServer;
  if (webServer === undefined || typeof webServer.register !== "function") {
    return { started: false, reason: "no web server on the context" };
  }
  const host = webServer.host;
  if (host !== "127.0.0.1") {
    logLine(`specstride-kanban: route not registered: web server host is ${String(host)}, not 127.0.0.1`);
    return { started: false, reason: "route not registered: web server host is not 127.0.0.1" };
  }

  const gate: TokenGate = createTokenGate();
  const laneThreshold = laneThresholdOf(config, logLine);
  const disposers: (() => void)[] = [];

  // The view route (T-39: GET only, exact path; the handler checks in contract order).
  const routeDispose = webServer.register({
    name: "specstride-kanban-view",
    path: VIEW_PATH,
    kind: "exact",
    // The host's handler owns the response lifecycle: `node:http` `(req, res)`
    // (settled against the real dsh, T049). When a response is given the
    // reply is written to it; the Reply is still returned so the fake hosts
    // of the unit tests read it without a response object.
    handler: async (request: unknown, response?: Responder) => {
      const reply = await createViewHandler(ctx, gate)(request as Parameters<ReturnType<typeof createViewHandler>[0]>[0]);
      if (response !== undefined) writeReply(response, reply);
      return reply;
    },
  });
  if (typeof routeDispose === "function") disposers.push(routeDispose);

  // The index tap: one fresh token per response, plus the threshold meta (R5,
  // R9). Hosts with `tapIndex` get a string transform — the host applies the
  // taps to the rendered index HTML and streams the result (settled by the
  // real-dsh spike, T055: `tapIndex((html) => html.replace(...))`); other
  // hosts take the index as an exact route at `/`.
  const metas = (): string => `${tokenMeta(gate.mint())}${thresholdMeta(laneThreshold)}`;
  if (typeof webServer.tapIndex === "function") {
    const tapDispose = webServer.tapIndex(function specstrideKanbanIndexTap(html: unknown): unknown {
      if (typeof html !== "string" || !html.includes("<head>")) return html;
      return html.replace("<head>", `<head>${metas()}`);
    });
    if (typeof tapDispose === "function") disposers.push(tapDispose);
  } else {
    const indexHandler = (_request: { url?: string }) => {
      const token = gate.mint();
      const body = `<!doctype html><html><head>${tokenMeta(token)}${thresholdMeta(laneThreshold)}</head><body></body></html>`;
      return {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", [TOKEN_HEADER]: token },
        body,
      };
    };
    const indexDispose = webServer.register({
      name: "specstride-kanban-index",
      path: "/",
      kind: "exact",
      handler: indexHandler,
    });
    if (typeof indexDispose === "function") disposers.push(indexDispose);
  }

  const dispose = () => {
    for (const disposer of disposers) disposer();
    disposers.length = 0;
    for (const entry of gate.live()) gate.voidToken(entry.token); // unload voids every token
  };
  ctx?.effect?.add?.(dispose); // held by cordis when the host offers an effect bag
  return { started: true, dispose, gate };
}

export { THRESHOLD_META_NAME, TOKEN_HEADER, VIEW_PATH };
