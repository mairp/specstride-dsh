/**
 * T027 — the packaging gate (F120-FR-018, F120-FR-019, F120-FR-022).
 *
 * `files` ships only `bin/` and `skills/` — never `tests/`, `evals/` or the
 * suites/fixtures; no install script and nothing that compiles at install
 * (proven against the `npm pack --dry-run` file list); dependencies are
 * exact-version `file:vendor/core/…` only; and the release facts: the
 * engine version is recorded verbatim from `core-pin.json`, the release is
 * built by `scripts/build.ts` (never by hand), and nothing here publishes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// npm-cli.js sits under the node prefix that ships this node: <prefix>/lib/node_modules/…
// (prefix = two levels above the node binary). Fall back to `npm` from the PATH.
const NPM = (() => {
  const candidate = join(dirname(dirname(process.execPath)), "lib", "node_modules", "npm", "bin", "npm-cli.js");
  if (existsSync(candidate)) return candidate;
  const execpath = process.env.npm_execpath;
  if (execpath && execpath.endsWith("npm-cli.js")) return execpath;
  return "npm"; // resolved from PATH by execFileSync
})();

type Manifest = {
  name: string;
  version: string;
  private?: boolean;
  files?: string[];
  bin?: Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  specstride?: { engineVersion?: string; protocol?: { min: number; max: number } };
};

const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as Manifest;

function packedFileList(): string[] {
  const output = execFileSync(process.execPath, [NPM, "pack", "--dry-run", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const parsed = JSON.parse(output) as { files?: { path: string }[] }[] | { files?: { path: string }[] };
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  return (entry.files ?? []).map((file) => file.path);
}

test("files ships only bin/ and skills/ — never tests/, evals/ or the suites/fixtures", () => {
  assert.deepEqual(manifest.files, ["bin/", "skills/"]);
});

test("the npm pack --dry-run file list never carries tests/, evals/, specs/ or vendor/", () => {
  const files = packedFileList();
  assert.ok(files.length > 0, "pack produced a file list");
  for (const path of files) {
    assert.doesNotMatch(path, /^(tests|evals|specs|vendor|research|prompts|scripts|src)\//, path);
    assert.doesNotMatch(path, /(^|\/)\./, path);
  }
  for (const required of [
    "bin/specstride-host-dsh.mjs",
    "bin/specstride.mjs",
    "skills/specstride-run/SKILL.md",
    "skills/specstride-reverse/SKILL.md",
    "skills/specstride-doctor/SKILL.md",
  ]) {
    assert.ok(files.includes(required), `${required} shipped`);
  }
});

test("no install script and nothing that compiles at install (F120-FR-018)", () => {
  const scripts = manifest.scripts ?? {};
  for (const forbidden of ["preinstall", "postinstall", "prepare", "prepack", "postpack"]) {
    assert.equal(forbidden in scripts, false, `no ${forbidden} script`);
  }
  assert.equal(typeof scripts.build, "string", "build is a script, run by hand — never at install");
});

test("dependencies are exact-version file:vendor/core/… only", () => {
  const dependencies = manifest.dependencies ?? {};
  assert.deepEqual(Object.keys(dependencies).sort(), ["@specstride/contracts", "@specstride/host-kit"]);
  for (const [name, spec] of Object.entries(dependencies)) {
    assert.match(spec, /^file:vendor\/core\/.+\.tgz$/, `${name}`);
    assert.doesNotMatch(spec, /[\^~><=]/, `${name}: exact pin only`);
  }
  const devDependencies = manifest.devDependencies ?? {};
  for (const spec of Object.values(devDependencies)) {
    assert.match(spec, /^file:vendor\/core\/.+\.tgz$/);
  }
});

test("the bin map holds exactly two keys and never a specstride key (R6)", () => {
  assert.deepEqual(Object.keys(manifest.bin ?? {}).sort(), ["specstride-dsh", "specstride-host-dsh"]);
});

test("release facts: engineVersion verbatim from core-pin.json, build by scripts/build.ts, nothing publishes", () => {
  const pin = JSON.parse(readFileSync(join(ROOT, "core-pin.json"), "utf8")) as { version?: string };
  assert.equal(manifest.specstride!.engineVersion!, pin.version, "engineVersion recorded verbatim from the pin");
  assert.equal(manifest.private, true, "nothing here publishes — the owner publishes");
  // The release is built by scripts/build.ts, never by hand: the build script
  // is the sole writer of the shipped artifacts.
  const build = readFileSync(join(ROOT, "scripts", "build.ts"), "utf8");
  assert.match(build, /writeFileSync\(target/, "build.ts writes the skills/");
  assert.match(build, /renderShimScript/, "build.ts renders bin/specstride.mjs");
  assert.match(build, /install record|release/i);
  assert.ok(!/git\b/.test(build.replace(/digit|logger|navigate/g, "")), "no git command in the build");
});
