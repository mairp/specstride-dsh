/**
 * T049 — the real-dsh install lane (PT-121-019, PT-121-001, PT-121-015,
 * PT-121-016; settles HF-19, HF-21, HF-22, HF-23 and the index half of HF-17).
 * Skipped, with the reason, unless dsh 0.1.0-rc.8 is on PATH.
 *
 * Both packages are packed (the host from the repo root, the plugin after
 * `buildKanban`), installed into a throwaway `DSH_HOME` web profile with
 * `dsh plugin --profile web add <host.tgz> <plugin.tgz> --save-exact`, and the
 * web profile is booted on port 0 with no credentials and no model. Asserted:
 * the start line, the client bundle served, the token meta in the index, a
 * token-bound GET answering `no-run` for a session in an empty temporary
 * workspace, 403 without the token; a restart with the web server host set to
 * `0.0.0.0` answers the SPA fallback (200 text/html, HF-26) with the one
 * refusal log line; removal leaves a profile that boots without the route;
 * 120's `host.kanban-plugin` doctor check reads `ok` then `info`.
 *
 * Every observation stays in this file: the test never writes `verifiedOn` to
 * src/host-facts.ts — that is the person step described in the plugin README's
 * live-probe runbook. No model is configured and no prompt is sent.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildKanban } from "../../scripts/build-kanban.ts";

const PIN = "0.1.0-rc.8";
const version = spawnSync("dsh", ["--version"], { encoding: "utf8" });
const found = version.error ? "dsh not found on PATH" : `dsh ${version.stdout.trim() || "(no version)"}`;
const skip =
  version.error === undefined && version.stdout.trim() === PIN
    ? false
    : `skipped: dsh ${PIN} not on PATH (${found})`;

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const repoRoot = join(packageRoot, "..", "..");
const pluginVersion = (JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { version: string }).version;
const PLUGIN_ID = "@specstride/dsh-kanban";
const HOST_ID = "@specstride/host-dsh";
const TOKEN_META = 'name="specstride-view-token"';

type Boot = { port: number; line: string; output: string; child: import("node:child_process").ChildProcess; exited: () => boolean };

/** Bound-port-and-line wait: the URL line plus, when asked, the plugin's one start/refusal line. */
async function waitForPortAndLine(child: import("node:child_process").ChildProcess, what: string, opts: { requireLine?: boolean; limitMs?: number } = {}): Promise<{ port: number; line: string | undefined; output: () => string }> {
  const { requireLine = true, limitMs = 90_000 } = opts;
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  let exited = false;
  child.once("exit", () => (exited = true));
  const end = Date.now() + limitMs;
  for (;;) {
    const urlLine = output.split("\n").find((l) => l.includes("dsh web:"));
    const port = Number(urlLine?.match(/:(\d+)\s*$/)?.[1] ?? urlLine?.match(/dsh web: http:\/\/[^:]+:(\d+)/)?.[1]);
    const line = output.split("\n").find((l) => l.startsWith("specstride-kanban:"));
    if (!Number.isNaN(port) && port > 0 && (line !== undefined || !requireLine)) return { port, line, output: () => output };
    if (exited) throw new Error(`dsh exited before binding (${what}):\n${output}`);
    if (Date.now() > end) throw new Error(`timed out waiting for the ${what} boot (port and plugin line):\n${output}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** GET with optional headers; status, headers and body text back. */
async function httpFetch(url: string, headers: Record<string, string> = {}): Promise<{ status: number; contentType: string; body: string }> {
  const response = await fetch(url, { headers });
  return { status: response.status, contentType: response.headers.get("content-type") ?? "", body: await response.text() };
}

async function stopDsh(child: import("node:child_process").ChildProcess): Promise<void> {
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
  });
}

/** Pack the plugin (after the real build stage) and the host from the repo root. */
function packBoth(scratch: string): { plugin: string; host: string } {
  assert.equal(buildKanban().summary !== undefined, true, "buildKanban produced no summary");
  const packed = spawnSync("npm", ["pack", "--pack-destination", scratch], { cwd: packageRoot, encoding: "utf8" });
  if (packed.error !== undefined) throw new Error(`npm pack (plugin) failed: ${String(packed.error)}`);
  const plugin = join(scratch, readdirSync(scratch).find((name) => name === `specstride-dsh-kanban-${pluginVersion}.tgz`)!);

  const hostPacked = spawnSync("npm", ["pack", "--pack-destination", scratch], { cwd: repoRoot, encoding: "utf8" });
  if (hostPacked.error !== undefined) throw new Error(`npm pack (host) failed: ${String(hostPacked.error)}`);
  const hostTarball = join(scratch, readdirSync(scratch).find((name) => name.startsWith("specstride-host-dsh-") && name.endsWith(".tgz"))!);
  // rc.8 installs through pnpm, which resolves the packed host's `file:` vendor
  // dependencies against the profile directory (they do not exist there). The
  // lane repacks the host without dependency fields — the same repack shape the
  // fail-open lane uses for its broken variants — leaving the package otherwise
  // intact.
  const unpacked = join(scratch, "host-unpacked");
  mkdirSync(unpacked, { recursive: true });
  execFileSync("tar", ["-xzf", hostTarball, "-C", unpacked]);
  const manifestPath = join(unpacked, "package", "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) delete manifest[field];
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const host = join(scratch, "host-lane.tgz");
  execFileSync("tar", ["-czf", host, "-C", unpacked, "package"]);
  return { plugin, host };
}

/** 120's doctor, filtered on host.kanban-plugin, against the throwaway DSH_HOME. */
function doctorKanban(home: string): { severity: string; message: string } {
  const run = spawnSync(process.execPath, [join(repoRoot, "bin", "specstride-host-dsh.mjs"), "doctor", "--json", "host.kanban-plugin"], {
    cwd: repoRoot,
    env: { ...process.env, DSH_HOME: home },
    encoding: "utf8",
  });
  assert.equal(run.error, undefined, `the doctor did not run: ${String(run.error)}`);
  const record = JSON.parse(run.stdout) as { findings: { id: string; severity: string; message: string }[] };
  const finding = record.findings.find((f) => f.id === "host.kanban-plugin");
  assert.ok(finding, "the doctor printed no host.kanban-plugin finding");
  return { severity: finding.severity, message: finding.message };
}

test("dsh rc.8: the packed plugin installs into a temporary DSH_HOME and the real lane holds", { skip, timeout: 300_000 }, async () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "kanban-install-")));
  const home = join(scratch, "dsh-home");
  const workspace = join(scratch, "workspace");
  mkdirSync(home);
  mkdirSync(workspace);
  const manifestPath = join(home, "profiles", "web", "package.json");
  const bootOpts = { env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_MODE: "DISABLED" }, stdio: ["ignore", "pipe", "pipe"], cwd: workspace } as const;

  try {
    const { plugin, host } = packBoth(scratch);

    // Install both tarballs into the web profile.
    const add = spawnSync("dsh", ["plugin", "--profile", "web", "add", host, plugin, "--save-exact"], { env: { ...process.env, DSH_HOME: home }, encoding: "utf8", input: "", timeout: 120_000 });
    assert.equal(add.status, 0, `dsh plugin add failed (${add.status}):\n${add.stdout}\n${add.stderr}`);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const saved = manifest.dependencies?.[PLUGIN_ID] ?? manifest.devDependencies?.[PLUGIN_ID];
    assert.ok(typeof saved === "string" && !/[\^~><=*]/.test(saved), `the profile does not pin ${PLUGIN_ID}: ${JSON.stringify(saved)}`);
    // rc.8 (pnpm) saves a `file:` ref for a tarball add; re-pin to the bare
    // exact version — the pin the README tells a person to write — so the
    // doctor's exact-pin rule can read the profile.
    assert.equal(manifest.dependencies![PLUGIN_ID]!.startsWith("file:"), true, `unexpected saved spec: ${saved}`);
    manifest.dependencies![PLUGIN_ID] = pluginVersion;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    // Boot 1: loopback, port 0, no credentials.
    const child1 = spawn("dsh", ["--profile", "web", "--port", "0", "--host", "127.0.0.1", "--no-open"], bootOpts);
    const boot1 = await waitForPortAndLine(child1, "first");
    try {
      assert.equal(boot1.line, `specstride-kanban: server half started ${pluginVersion}`, "the start line is not the one the plugin prints once");

      const base = `http://127.0.0.1:${boot1.port}`;
      const index = await httpFetch(`${base}/`);
      assert.equal(index.status, 200, "the index was not served");
      assert.ok(index.contentType.includes("text/html"), "the index is not text/html");
      const token = new RegExp(`${TOKEN_META.replace(/[":]/g, "\\$&")} content="([^"]+)"`).exec(index.body)?.[1];
      assert.ok(token, `the index carries no view-token meta:\n${index.body.slice(0, 400)}`);

      // The client bundle is served: the deterministic path dsh exposes for an
      // installed client plugin, plus every script the index references.
      const client = await httpFetch(`${base}/plugins/${PLUGIN_ID}/client.js`);
      assert.equal(client.status, 200, "the plugin's client bundle was not served");
      assert.ok(client.contentType.includes("javascript"), "client.js is not JavaScript");
      assert.ok(client.body.includes("window.__ModuleLoader__"), "client.js is not the plugin's module table");
      for (const src of [...index.body.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]!)) {
        const script = await httpFetch(src.startsWith("http") ? src : `${base}${src}`);
        assert.equal(script.status, 200, `a script referenced by the index was not retrievable: ${src}`);
        assert.ok(script.body.length > 0, `an index-referenced script came back empty: ${src}`);
      }

      // The route: token-bound no-run in an empty workspace, 403 without the token.
      // A syntactically valid id of a session that does not exist resolves no-run.
      const session = "no-such-session-in-an-empty-workspace";
      const withToken = await httpFetch(`${base}/specstride/view?session=${session}`, { "specstride-view-token": token! });
      assert.equal(withToken.status, 200, `the token-bound GET did not answer 200: ${withToken.status}`);
      assert.ok(withToken.contentType.includes("application/json"), "the token-bound GET is not application/json");
      assert.deepEqual(JSON.parse(withToken.body), { answer: "no-run" }, "an unknown session in an empty workspace must answer no-run");
      const withoutToken = await httpFetch(`${base}/specstride/view?session=${session}`);
      assert.equal(withoutToken.status, 403, "the tokenless GET did not answer 403");
      assert.deepEqual(JSON.parse(withoutToken.body), { answer: "forbidden" }, "the tokenless GET must answer forbidden");

      // 120's doctor reads ok while the plugin is pinned exactly.
      const installed = doctorKanban(home);
      assert.equal(installed.severity, "ok", `host.kanban-plugin must read ok on an exact pin, got ${installed.severity}`);
      assert.match(installed.message, /server half (started|unknown)/, `the doctor message lacks the start state: ${installed.message}`);
    } finally {
      await stopDsh(child1);
    }

    // Boot 2: the web server host set to 0.0.0.0. rc.8 takes the host from the
    // webStartup flags and `--host 0.0.0.0` is refused on the command line, so
    // the lane sets it the way a deployment does: a patch overlay restating the
    // webserver row's whole config (the profile's own patch layer).
    const overlay = join(scratch, "host-all-interfaces.yml");
    writeFileSync(overlay, "- id: webserver\n  inject: [webStartup]\n  config:\n    host: '0.0.0.0'\n    port: !!js ctx.webStartup.port ?? 0\n");
    const child2 = spawn("dsh", ["--profile", "web", "--patch", overlay, "--port", "0", "--no-open"], bootOpts);
    const boot2 = await waitForPortAndLine(child2, "0.0.0.0");
    try {
      const refusalLines = boot2.output().split("\n").filter((l) => l.startsWith("specstride-kanban:"));
      assert.equal(refusalLines.length, 1, `expected exactly one plugin log line, got: ${JSON.stringify(refusalLines)}`);
      assert.equal(boot2.line, "specstride-kanban: route not registered: web server host is 0.0.0.0, not 127.0.0.1", "the refusal line is not the one the plugin prints once");
      const base = `http://127.0.0.1:${boot2.port}`;
      const index = await httpFetch(`${base}/`);
      assert.equal(index.status, 200, "the index was not served with host 0.0.0.0");
      assert.ok(!index.body.includes(TOKEN_META), "the index must not carry the view-token meta when the route is not registered");
      const view = await httpFetch(`${base}/specstride/view?session=no-such-session`);
      assert.equal(view.status, 200, "the view path did not answer the SPA fallback");
      assert.ok(view.contentType.includes("text/html"), `the SPA fallback must be text/html, got ${view.contentType}`);
      assert.throws(() => JSON.parse(view.body), "the fallback answer must not be JSON (HF-26)");
    } finally {
      await stopDsh(child2);
    }

    // Remove the plugin: the profile boots without the route.
    const remove = spawnSync("dsh", ["plugin", "--profile", "web", "remove", PLUGIN_ID], { env: { ...process.env, DSH_HOME: home }, encoding: "utf8", input: "", timeout: 120_000 });
    assert.equal(remove.status, 0, `dsh plugin remove failed (${remove.status}):\n${remove.stdout}\n${remove.stderr}`);
    const afterRemove = JSON.parse(readFileSync(manifestPath, "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    assert.equal(afterRemove.dependencies?.[PLUGIN_ID] ?? afterRemove.devDependencies?.[PLUGIN_ID], undefined, "the profile still lists the plugin after removal");

    const child3 = spawn("dsh", ["--profile", "web", "--port", "0", "--host", "127.0.0.1", "--no-open"], bootOpts);
    const boot3 = await waitForPortAndLine(child3, "post-removal", { requireLine: false });
    try {
      assert.equal(boot3.output().includes("specstride-kanban"), false, "a removed plugin must not log into the boot");
      const base = `http://127.0.0.1:${boot3.port}`;
      const index = await httpFetch(`${base}/`);
      assert.equal(index.status, 200, "the index was not served after removal");
      assert.ok(!index.body.includes(TOKEN_META), "the index carries the token meta after removal");
      const view = await httpFetch(`${base}/specstride/view?session=no-such-session`);
      assert.ok(view.status === 200 || view.status === 404, `the view path after removal answered ${view.status}`);
      assert.ok(!view.contentType.includes("application/json"), "the view path after removal must not answer the JSON API");
      assert.throws(() => JSON.parse(view.body), "the post-removal answer must not be the route's JSON");
    } finally {
      await stopDsh(child3);
    }

    // 120's doctor reads info once the plugin is gone.
    const removed = doctorKanban(home);
    assert.equal(removed.severity, "info", `host.kanban-plugin must read info when absent, got ${removed.severity}`);
    assert.ok(removed.message.includes("not installed"), `the doctor message must say not installed: ${removed.message}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
