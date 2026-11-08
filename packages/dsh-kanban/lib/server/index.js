/**
 * T023 — the module start (contracts/plugin-package.md "Server half lifecycle").
 * The gate (host 127.0.0.1 only), token checks and fail-open wrapping land in
 * US4/US5; this start keeps the public API tiny: one route, one disposer.
 */
import { createViewHandler, VIEW_PATH } from "./route.js";
                                              

                                                                                      

export function start(ctx                                                                                                     , _config          )              {
  const webServer = ctx?.webServer;
  if (webServer === undefined || typeof webServer.register !== "function") {
    return { started: false, reason: "no web server on the context" };
  }
  if (webServer.host !== "127.0.0.1") {
    return { started: false, reason: "route not registered: web server host is not 127.0.0.1" };
  }
  const dispose = webServer.register({
    name: "specstride-kanban-view",
    path: VIEW_PATH,
    kind: "exact",
    handler: createViewHandler(ctx),
  });
  return { started: true, dispose: typeof dispose === "function" ? (dispose              ) : undefined };
}
