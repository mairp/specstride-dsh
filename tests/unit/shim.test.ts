/**
 * T008 — the shim binding (F120-FR-011).
 * The shipped file equals `shimScript(options)` byte for byte; resolution
 * order `SPECSTRIDE_BIN` → PATH (kit `resolveExecutable`); it fetches,
 * installs and updates nothing (kit purity invariant); missing CLI prints the
 * kit `missingCliLine()` naming the doctor and exits 127.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLI_NOT_FOUND_EXIT_CODE,
  EXECUTABLE_VARIABLE,
  INSTALLS_OR_UPDATES,
  missingCliLine,
  resolveExecutable,
  type ShimProbe,
  shimScript,
} from "@specstride/host-kit/shim";
import { dshShimOptions, dshInstallCommand, renderShimScript } from "../../src/shim.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENGINE_VERSION = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  specstride?: { engineVersion?: string };
}).specstride!.engineVersion!;

test("the shipped file equals shimScript(options) byte for byte", () => {
  const shipped = readFileSync(join(ROOT, "bin", "specstride.mjs"), "utf8");
  assert.equal(shipped, shimScript(dshShimOptions(ENGINE_VERSION)));
  assert.equal(shipped, renderShimScript(ENGINE_VERSION));
});

test("the dsh options remove the bundled-CLI step and name the two-step order", () => {
  const options = dshShimOptions(ENGINE_VERSION);
  assert.deepEqual(options.bundledCliSegments, []);
  const header = options.headerLines!.join("\n");
  assert.match(header, /SPECSTRIDE_BIN/);
  assert.match(header, /search path/);
  assert.match(header, /no third place/);
  assert.match(header, new RegExp(dshInstallCommand(ENGINE_VERSION).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(dshInstallCommand(ENGINE_VERSION), `npm install -g specstride@${ENGINE_VERSION}`);
});

function probeOf(env: Record<string, string | undefined>, existing: string[]): ShimProbe {
  return {
    env,
    shimDirectory: "/tmp/plugin/bin",
    isExecutable: (path: string) => existing.includes(path),
    publishedBin: () => null,
  };
}

test("resolution order: SPECSTRIDE_BIN, then the search path (kit resolveExecutable)", () => {
  const byVariable = resolveExecutable(
    probeOf({ [EXECUTABLE_VARIABLE]: "/opt/specstride/bin/specstride" }, [
      "/opt/specstride/bin/specstride",
    ]),
  );
  assert.equal(byVariable.path, "/opt/specstride/bin/specstride");
  assert.equal(byVariable.source, "explicit-variable");

  const byPath = resolveExecutable(
    probeOf({ PATH: "/usr/local/bin:/usr/bin" }, ["/usr/local/bin/specstride"]),
  );
  assert.equal(byPath.path, "/usr/local/bin/specstride");
  assert.equal(byPath.source, "search-path");

  const nowhere = resolveExecutable(probeOf({}, []));
  assert.equal(nowhere.path, null);
  // Two live steps plus the inert published-package step, which always
  // yields null because the manifest declares no bin["specstride"] key (R6).
  assert.equal(nowhere.steps.length, 3);
  assert.equal(nowhere.steps[2].source, "published-package");
  assert.equal(nowhere.steps[2].candidate, null);
  assert.equal(nowhere.steps[2].found, false);
});

test("it fetches, installs and updates nothing (kit purity invariant)", () => {
  assert.equal(INSTALLS_OR_UPDATES, false);
  const script = readFileSync(join(ROOT, "bin", "specstride.mjs"), "utf8");
  assert.ok(!/fetch\(|npm install(?! -g)/.test(script), "no fetching or installing");
  assert.ok(!script.includes("child_process") === false); // spawnSync is the only exec, of the CLI found
  assert.ok(!/https?:\/\//.test(script), "no network in the shipped shim");
});

test("missing CLI prints the kit missingCliLine() naming the doctor, exit 127", () => {
  const line = missingCliLine();
  assert.match(line, /specstride doctor/);
  assert.match(line, /npm install -g specstride@/);
  assert.equal(CLI_NOT_FOUND_EXIT_CODE, 127);
});

test("the manifest holds no bin[\"specstride\"] key (R6)", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    bin?: Record<string, string>;
  };
  assert.ok(manifest.bin !== undefined);
  assert.ok(!("specstride" in manifest.bin));
  assert.deepEqual(Object.keys(manifest.bin).sort(), [
    "specstride-dsh",
    "specstride-host-dsh",
  ]);
});
