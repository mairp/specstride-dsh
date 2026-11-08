/**
 * T022 (research.md R5, HF-23; F121-FR-007) — the workspace resolver.
 *
 * A session id arrives as a URL query parameter; it is validated before any
 * resolution. The live session's `header.cwd` wins over the cold header from
 * `ctx.sessionPersistence.list()`. The path must be absolute and an existing
 * directory, otherwise the route answers "no run" with 0 CLI calls.
 */
import { statSync } from "node:fs";
import { isAbsolute } from "node:path";

                       
                                                                     
                                                                                
  

                                                                                 

export const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function cwdOfLive(ctx         , sessionId        )          {
  const live = ctx.sessions?.get(sessionId);
  return live?.header?.cwd;
}

function cwdOfCold(ctx         , sessionId        )          {
  const cold = ctx.sessionPersistence?.list?.()?.find((header) => header?.sessionId === sessionId);
  return cold?.cwd;
}

/** The header `cwd` must be a string, absolute, and an existing directory. */
function usable(cwd         )           {
  if (typeof cwd !== "string" || cwd === "") return { ok: false, reason: "session has no working directory" };
  if (!isAbsolute(cwd)) return { ok: false, reason: "session working directory is relative" };
  try {
    if (!statSync(cwd).isDirectory()) return { ok: false, reason: "session working directory is not a directory" };
  } catch {
    return { ok: false, reason: "session working directory does not exist" };
  }
  return { ok: true, cwd };
}

export function resolveWorkspace(ctx         , sessionId        )           {
  if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)) {
    return { ok: false, reason: "session id is outside ^[A-Za-z0-9_-]{1,128}$" };
  }
  const live = cwdOfLive(ctx, sessionId);
  if (live !== undefined) return usable(live);
  return usable(cwdOfCold(ctx, sessionId));
}
