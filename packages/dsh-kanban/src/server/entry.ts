/**
 * T043 — the fail-open loader (research.md R12; contracts/plugin-package.md
 * "Server half lifecycle"; F121-FR-002, F121-SC-004). The bundle patch mounts
 * this module, never `index.ts` directly: cordis aborts boot when a mounted
 * module fails to import (R4 F3), so the throw must never escape here. The
 * top level imports only `node:` built-ins; the real module is imported
 * dynamically and started inside one guard. Any throw — at import or at
 * start — becomes exactly one line,
 * `specstride-kanban: server half unavailable: <error name>`, and `apply`
 * returns normally: no route, no index tap, dsh boots, the board's client
 * half shows the unavailable line because the page carries no view token.
 */
import { readFileSync } from "node:fs";

function logLine(line: string): void {
  console.error(line);
}

/** The version of this package, read lazily and never thrown from. */
function versionOf(): string {
  try {
    const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : "unknown";
  } catch {
    return "unknown";
  }
}

export const UNAVAILABLE_PREFIX = "specstride-kanban: server half unavailable:";

/**
 * The services `start` reads through the cordis context. Cordis refuses an
 * undeclared property access ("cannot get property … without inject"), so the
 * loader must know these names before `apply` runs; the array is data, not
 * code, and keeps the top-level import surface at `node:` only.
 */
export const inject = ["webServer", "sessions", "sessionPersistence"] as const;

/** The module name the loader records for the fiber (the insert row's id). */
export const name = "specstride-kanban-server";

/** The cordis apply: import and start the server half, or one line and return. */
export async function apply(ctx: unknown, config?: unknown): Promise<void> {
  try {
    const mod = (await import("./index.js")) as { start: (context: unknown, cfg?: unknown) => unknown };
    const result = mod.start(ctx, config) as { started?: boolean } | undefined;
    // One line per boot: started on a real start, the refusal case logs its own
    // single line inside the start and must not gain a second one here
    // (settled by T049's real-dsh lane).
    if (result?.started !== false) logLine(`specstride-kanban: server half started ${versionOf()}`);
  } catch (error) {
    logLine(`${UNAVAILABLE_PREFIX} ${(error as Error | undefined)?.name ?? "Error"}`);
  }
}

export default apply;
