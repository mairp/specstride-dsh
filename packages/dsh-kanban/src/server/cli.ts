/**
 * T022 (contracts/view-route.md "CLI calls"; F121-FR-004, F120-FR-012) — the CLI
 * runner. Everything runs through 120's shim `@specstride/host-dsh/bin/specstride.mjs`,
 * resolved from the peer with `import.meta.resolve`, spawned with
 * `process.execPath` — never a `specstride` binary from PATH. The shim's
 * `--protocol` probe runs before every call; on any mismatch the runner answers
 * "unavailable" without making the call. stdout is capped at 512 KiB; the
 * limits are 10 s idle / 30 s hard; the kill takes the process group and
 * escalates to SIGKILL 2 s later.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { acceptView, type ReadView } from "../shared/view-read.ts";
import { MAJOR_RANGE } from "../shared/generated/contract-values.ts";

export const SHIM_SPECIFIER = "@specstride/host-dsh/bin/specstride.mjs";
export const SUPPORTED_PROTOCOL = 1;
const STDOUT_CAP_BYTES = 512 * 1024;
const IDLE_LIMIT_MS = 10_000;
const HARD_LIMIT_MS = 30_000;
const SIGKILL_AFTER_MS = 2_000;

export type StatusResult =
  | { kind: "view"; view: ReadView; cursorToken: string }
  | { kind: "no-run" }
  | { kind: "refused-schema" }
  | { kind: "unavailable" };

export type WaitResult = StatusResult | { kind: "unchanged"; cursorToken: string };

/**
 * The file path of 120's shim, resolved from the peer package (throws when
 * absent). `KANBAN_SHIM_PATH` overrides the resolution with an absolute path —
 * the hook the tests use to give each test process its own stub peer, and the
 * hook an embedder may use to pin the shim.
 */
export function resolveShim(): string {
  const override = process.env.KANBAN_SHIM_PATH;
  if (override !== undefined && override !== "") return override;
  return fileURLToPath(import.meta.resolve(SHIM_SPECIFIER, import.meta.url));
}

export function cursorToken(view: ReadView): string {
  return `${view.cursor.offset}.${view.cursor.lastSeq}.${view.signature.token}`;
}

/** Kill the whole process group (POSIX negative pid); fall back to the child handle elsewhere. */
function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    child.kill(signal);
  }
}

function escalate(child: ChildProcess): void {
  const timer = setTimeout(() => killGroup(child, "SIGKILL"), SIGKILL_AFTER_MS);
  timer.unref?.();
}

function runShim(cwd: string, shimPath: string, argv: string[], idleLimitMs: number): Promise<{ code: number | null; stdout: string; capped: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [shimPath, ...argv], {
      cwd,
      shell: false,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let bytes = 0;
    let capped = false;
    const chunks: Buffer[] = [];
    let idle: NodeJS.Timeout | undefined;
    let hard: NodeJS.Timeout | undefined;
    const stopTimers = () => {
      if (idle !== undefined) clearTimeout(idle);
      if (hard !== undefined) clearTimeout(hard);
    };
    const stop = () => {
      stopTimers();
      killGroup(child, "SIGTERM");
      escalate(child);
    };
    const armIdle = () => {
      if (idle !== undefined) clearTimeout(idle);
      idle = setTimeout(stop, idleLimitMs);
      idle.unref?.();
    };
    hard = setTimeout(stop, HARD_LIMIT_MS);
    hard.unref?.();
    armIdle();
    child.stdout?.on("data", (chunk: Buffer) => {
      armIdle();
      bytes += chunk.length;
      if (bytes > STDOUT_CAP_BYTES) {
        capped = true;
        stop();
        return;
      }
      chunks.push(chunk);
    });
    const finish = (code: number | null) => {
      stopTimers();
      resolve({ code, stdout: Buffer.concat(chunks).toString("utf8"), capped });
    };
    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code));
  });
}

const SCHEMA_PATTERN = /^specstride\.view\/(\d+)$/;

function schemaMajor(value: unknown): number | null {
  const schema = (value as { schema?: unknown } | null)?.schema;
  if (typeof schema !== "string") return null;
  const match = SCHEMA_PATTERN.exec(schema);
  return match === null ? null : Number.parseInt(match[1] as string, 10);
}

function mapStatusOutput(code: number | null, stdout: string, capped: boolean): StatusResult {
  if (capped) return { kind: "unavailable" };
  if (code === 70) return { kind: "unavailable" };
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    return { kind: "unavailable" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { kind: "unavailable" };
  const record = value as Record<string, unknown>;
  // The inspect envelopes (the engine's own "nothing to show" answers) mean "no run".
  if (
    record.schema === "specstride.inspect.status/1" &&
    record.ok === false &&
    (record.reason === "no-state" || record.reason === "no-feature")
  ) {
    return { kind: "no-run" };
  }
  const accepted = acceptView(value);
  if (accepted.ok) return { kind: "view", view: accepted.view, cursorToken: cursorToken(accepted.view) };
  // Outside the supported major range is a refusal, not an outage (F121-FR-004).
  const major = schemaMajor(value);
  if (major !== null && (major < MAJOR_RANGE.from || major > MAJOR_RANGE.to)) return { kind: "refused-schema" };
  return { kind: "unavailable" };
}

/** `kanban status --json` in the given workspace, through the shim only. */
export async function status(cwd: string): Promise<StatusResult> {
  const call = await shimCall(cwd, ["kanban", "status", "--json"], IDLE_LIMIT_MS);
  if (call === null) return { kind: "unavailable" };
  return mapStatusOutput(call.code, call.stdout, call.capped);
}

/** The protocol probe plus one shim call, or `null` when the probe refused (F120-FR-012). */
async function shimCall(cwd: string, argv: string[], idleLimitMs: number) {
  let shimPath: string;
  try {
    shimPath = resolveShim();
  } catch {
    return null;
  }
  const probe = await runShim(cwd, shimPath, ["--protocol"], IDLE_LIMIT_MS);
  const protocol = Number.parseInt(probe.stdout.trim(), 10);
  if (probe.capped || probe.code !== 0 || protocol !== SUPPORTED_PROTOCOL) return null;
  return runShim(cwd, shimPath, argv, idleLimitMs);
}

/**
 * `kanban wait --until-change --cursor <token> --timeout 25` in the workspace,
 * through the shim only (contracts/view-route.md "CLI calls"). The idle limit is
 * the wait timeout (25 s) plus its 5 s grace — the runner's 30 s hard limit
 * kills a `wait` that never answers, and that answers "unavailable".
 */
export const WAIT_TIMEOUT_SECONDS = 25;
const WAIT_LIMIT_MS = (WAIT_TIMEOUT_SECONDS + 5) * 1000;

export async function wait(cwd: string, cursor: string): Promise<WaitResult> {
  const call = await shimCall(
    cwd,
    ["kanban", "wait", "--until-change", "--cursor", cursor, "--timeout", String(WAIT_TIMEOUT_SECONDS)],
    WAIT_LIMIT_MS,
  );
  if (call === null || call.capped || call.code !== 0) return { kind: "unavailable" };
  if (call.stdout.trim() === "") return { kind: "unchanged", cursorToken: cursor };
  // A change line: exactly one `status --json` fetches the new view.
  return status(cwd);
}
