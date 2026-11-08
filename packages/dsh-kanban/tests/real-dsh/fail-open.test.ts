/**
 * T042 — the real-dsh fail-open lane (PT-121-002; F121-SC-004; settles HF-21,
 * HF-25). Skipped, with the reason, unless dsh 0.1.0-rc.8 is on PATH.
 *
 * A variant of the packed plugin whose server half throws at import, then one
 * whose start throws, is installed into a temporary DSH_HOME with
 * `dsh plugin --profile web add … --save-exact`. The web profile boots with
 * the web server on 127.0.0.1 and an OS-assigned port (`--port 0`, HF-20; the
 * port is read from the shell's URL line), `DSH_TELEMETRY_MODE=DISABLED` and
 * no credentials. Asserted: the index is served, the plugin's client bundle is
 * served, the index carries no `specstride-view-token` meta, `/specstride/view`
 * answers 200 `text/html` (the SPA fallback, HF-26) and not JSON, the log
 * holds the one unavailable line, no request leaves for a provider host, and
 * 120's `specstride-host-dsh doctor` still runs. No model is configured and no
 * prompt is sent.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PIN = "0.1.0-rc.8";
const version = spawnSync("dsh", ["--version"], { encoding: "utf8" });
const found = version.error ? "dsh not on PATH" : `dsh ${version.stdout.trim() || "(no version)"}`;
const skip = version.error === undefined && version.stdout.trim() === PIN ? false : `skipped: dsh ${PIN} is not on PATH (${found})`;

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const repoRoot = join(packageRoot, "..", "..");

/** Pack the plugin, then repack a variant whose server half index throws as told. */
function packVariant(throwKind: "import" | "start", scratch: string): string {
  const packed = spawnSync("npm", ["pack", "--pack-destination", scratch], { cwd: packageRoot, encoding: "utf8" });
  if (packed.error !== undefined) throw new Error(`npm pack failed: ${String(packed.error)}`);
  const tarball = join(scratch, readdirSync(scratch).find((name) => name.endsWith(".tgz"))!);
  const unpacked = join(scratch, `package-${throwKind}`);
  mkdirSync(unpacked, { recursive: true });
  execFileSync("tar", ["-xzf", tarball, "-C", unpacked]);
  const index = join(unpacked, "package", "lib", "server", "index.js");
  assert.ok(existsSync(index), "the packed plugin lacks lib/server/index.js");
  const broken =
    throwKind === "import"
      ? `throw new Error("variant: boom at import");\n`
      : `export function start() { throw new RangeError("variant: boom at start"); }\n`;
  writeFileSync(index, broken);
  const variantDir = join(scratch, `variant-${throwKind}`);
  mkdirSync(variantDir, { recursive: true });
  const variantTarball = join(variantDir, "dsh-kanban-variant.tgz");
  execFileSync("tar", ["-czf", variantTarball, "-C", unpacked, "package"]);
  return variantTarball;
}

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

/** Boot the web profile with the broken variant installed and run the assertions. */
async function bootWithBroken(variantTarball: string, which: "import" | "start", errorName: string): Promise<void> {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), `kanban-failopen-${which}-`)));
  const home = join(scratch, "dsh-home");
  mkdirSync(home);
  const logPath = join(scratch, "dsh.log");
  const port = await freePort();

  const add = spawnSync("dsh", ["plugin", "--profile", "web", "add", variantTarball, "--save-exact"], {
    env: { ...process.env, DSH_HOME: home },
    encoding: "utf8",
  });
  if (add.error !== undefined) throw new Error(`dsh plugin add failed: ${String(add.error)}`);

  const child = spawn("dsh", ["--profile", "web", "--port", String(port), "--host", "127.0.0.1", "--no-open"], {
    env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_MODE: "DISABLED" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
  let exited = false;
  child.once("exit", () => (exited = true));

  try {
    await until("the dsh web URL line", 90_000, () => {
      if (exited) throw new Error(`dsh exited before binding (${which} variant):\n${output}`);
      return /dsh web: http:\/\/127\.0\.0\.1:(\d+)/.exec(output)?.[1] !== undefined ? true : undefined;
    });
    const actualPort = Number(/dsh web: http:\/\/127\.0\.0\.1:(\d+)/.exec(output)![1]);
    const base = `http://127.0.0.1:${actualPort}`;

    // dsh boots and serves the UI.
    const index = await fetch(`${base}/`);
    assert.equal(index.status, 200, "dsh did not serve the index");
    const html = await index.text();
    assert.ok(html.includes("<!doctype html") || html.includes("<html"), "the index is not the UI page");

    // The client bundle is served, but the index carries no token meta: the
    // server half never registered its tap (HF-25).
    const client = await fetch(`${base}/plugins/@specstride/dsh-kanban/client.js`);
    assert.equal(client.status, 200, "the plugin's client bundle was not served");
    assert.equal((client.headers.get("content-type") ?? "").includes("javascript"), true, "client.js is not JavaScript");
    assert.ok(!html.includes('name="specstride-view-token"'), "the index must not carry the view token meta when the server half is down");

    // The view path falls through to the SPA fallback: 200 text/html, not JSON (HF-26).
    const view = await fetch(`${base}/specstride/view?session=x`);
    assert.equal(view.status, 200);
    assert.equal((view.headers.get("content-type") ?? "").includes("text/html"), true, "/specstride/view must answer the fallback as text/html");
    const body = await view.text();
    assert.throws(() => JSON.parse(body), "the fallback answer must not be JSON");

    // Exactly one unavailable line in the log.
    const lines = output.split("\n").filter((line) => line.includes("specstride-kanban"));
    assert.equal(lines.length, 1, `expected exactly one specstride-kanban log line, got: ${JSON.stringify(lines)}`);
    assert.match(lines[0]!, new RegExp(`^specstride-kanban: server half unavailable: ${errorName}$`), which);

    // No request left for a provider host: everything in the log is loopback.
    for (const match of output.matchAll(/https?:\/\/[^\s"'<>]+/g)) {
      const url = match[0];
      assert.ok(url.includes("127.0.0.1") || url.includes("localhost"), `a non-loopback URL appeared in the log: ${url}`);
    }
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
    rmSync(scratch, { recursive: true, force: true });
  }
}

test("dsh rc.8: a server half that throws at import leaves dsh booting", { skip, timeout: 180_000 }, async () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "kanban-variant-")));
  try {
    const tarball = packVariant("import", scratch);
    await bootWithBroken(tarball, "import", "Error");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("dsh rc.8: a server half that throws at start leaves dsh booting", { skip, timeout: 180_000 }, async () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "kanban-variant-")));
  try {
    const tarball = packVariant("start", scratch);
    await bootWithBroken(tarball, "start", "RangeError");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("120's specstride-host-dsh doctor still runs beside the broken plugin", { skip, timeout: 60_000 }, () => {
  const run = spawnSync(process.execPath, [join(repoRoot, "bin", "specstride-host-dsh.mjs"), "doctor"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(run.error, undefined, `the doctor did not run: ${String(run.error)}`);
  assert.match(run.stdout + run.stderr, /host\.dsh-version|host\.cli-found/, "the doctor printed no checks");
});
