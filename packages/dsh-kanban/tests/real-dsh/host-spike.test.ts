/**
 * T055 — the real-dsh spike (settles HF-21, HF-22, HF-23; never writes `verifiedOn`).
 *
 * A throwaway cordis module, mounted by a `--patch` overlay into a temporary `DSH_HOME`,
 * injects `webServer` and `sessions`, registers `/specstride/view-spike` (exact), taps the
 * index with one `<meta name="specstride-spike">`, and logs
 * `ctx.sessions.get(id)?.header.cwd` for one live session created for a temporary workspace.
 * Skipped, with the reason, unless dsh 0.1.0-rc.8 is on PATH. No model is configured and no
 * prompt is sent. The person who runs it writes `verifiedOn` back to the rows (src/host-facts.ts).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync, existsSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const PIN = "0.1.0-rc.8";
const version = spawnSync("dsh", ["--version"], { encoding: "utf8" });
const found = version.error ? "dsh not on PATH" : `dsh ${version.stdout.trim() || "(no version)"}`;
const skip = version.error === undefined && version.stdout.trim() === PIN ? false : `skipped: dsh ${PIN} is not on PATH (${found})`;

const SPIKE_MODULE = `import fs from "node:fs";
export const name = "specstride-spike";
export const inject = ["webServer", "sessions"];
export function apply(ctx) {
  const log = (line) => fs.appendFileSync(process.env.SPIKE_LOG, line + "\\n");
  log("apply:start");
  ctx.effect(() => ctx.webServer.register({
    name: "specstride-view-spike", path: "/specstride/view-spike", kind: "exact",
    handler: async (_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ answer: "spike" }));
    },
  }), "specstride spike route");
  ctx.effect(() => ctx.webServer.tapIndex((html) => html.replace("<head>", '<head><meta name="specstride-spike" content="1">')), "specstride spike tap");
  ctx.sessions.create("spike-session", { meta: { cwd: process.env.SPIKE_CWD } });
  log("cwd:" + (ctx.sessions.get("spike-session")?.header.cwd ?? "undefined"));
}
`;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

async function until<T>(what: string, limitMs: number, probe: () => Promise<T | undefined> | T | undefined): Promise<T> {
  const end = Date.now() + limitMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

test("dsh rc.8 web profile: an outside cordis module registers a route, taps the index and reads a session cwd", { skip, timeout: 120_000 }, async () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "spike-")));
  const home = join(scratch, "dsh-home");
  const workspace = join(scratch, "workspace");
  mkdirSync(home);
  mkdirSync(workspace);
  const modulePath = join(scratch, "spike.mjs");
  const overlay = join(scratch, "overlay.yml");
  const logPath = join(scratch, "spike.log");
  writeFileSync(modulePath, SPIKE_MODULE);
  writeFileSync(overlay, `- insert:\n    - id: specstride-spike\n      name: ${modulePath}\n`);
  const port = await freePort();

  const child = spawn("dsh", ["--profile", "web", "--patch", overlay, "--port", String(port), "--host", "127.0.0.1", "--no-open"], {
    env: { ...process.env, DSH_HOME: home, SPIKE_LOG: logPath, SPIKE_CWD: workspace, DSH_TELEMETRY_MODE: "DISABLED" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
  let exited = false;
  child.once("exit", () => (exited = true));

  try {
    await until("the dsh web URL line", 90_000, () => {
      if (exited) throw new Error(`dsh exited before binding. HF-21: a patch-mounted outside module did not boot.\n${output}`);
      return /dsh web: http:\/\/127\.0\.0\.1:\d+/.test(output) ? true : undefined;
    });
    const base = `http://127.0.0.1:${port}`;

    // HF-21: the module injected webServer and registered a route.
    const route = await fetch(`${base}/specstride/view-spike`);
    assert.equal(route.status, 200, "HF-21 failed: the route did not answer 200 — research.md R5 (route/token design) changes before T040");
    assert.deepEqual(await route.json(), { answer: "spike" }, "HF-21 failed: the route answered something else");

    // HF-22: a third-party module's tapIndex reaches the served index.
    const index = await (await fetch(`${base}/`)).text();
    assert.ok(index.includes('<meta name="specstride-spike" content="1">'), "HF-22 failed: the served index lacks the tapped meta — use the mint fallback of research.md R5 before T040");

    // HF-23: a live session's header.cwd is readable.
    assert.ok(existsSync(logPath), "HF-21 failed: the module never ran");
    const lines = readFileSync(logPath, "utf8").split("\n");
    assert.ok(lines.includes("apply:start"));
    assert.ok(lines.includes(`cwd:${workspace}`), `HF-23 failed: header.cwd was ${JSON.stringify(lines.find((l) => l.startsWith("cwd:")))}, expected ${workspace} — T022's resolver changes before US1`);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve(undefined);
      }, 5000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve(undefined);
      });
      if (exited) resolve(undefined);
    });
  }
});
