#!/usr/bin/env node
/**
 * T034 — record the host's `--dsw-alias-*` tokens (research.md R8, F121-FR-011).
 *
 * Reads the theme stylesheet of the dsh on PATH and writes
 * `tests/fixtures/dsw-tokens.rc8.json`: every alias token name with its light
 * (`body { … }`) and dark (`body[data-ds-dark-theme] { … }`) value, with
 * `verifiedOn` and the pin.
 *
 * Refuses to write unless `dsh --version` and the located package's manifest
 * are both exactly the pin `0.1.0-rc.8` — a fixture must never record a build
 * it was not pinned to.
 *
 * Deviation from the task text, recorded here: the task says
 * `dsh-client-ui-theme/src/styles/*.css`, but rc.8 ships that package built
 * only (`lib/`, no `src/`); the same stylesheet is embedded as a string in
 * `lib/client.js` and is read from there. The fixture's `source` field says so.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PIN = "0.1.0-rc.8";
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_PATH = join(PACKAGE_ROOT, "tests", "fixtures", "dsw-tokens.rc8.json");

const refuse = (message) => {
  console.error(`record-dsw-tokens: ${message}`);
  process.exit(1);
};

const dshVersion = execFileSync("dsh", ["--version"], { encoding: "utf8" }).trim();
if (dshVersion !== PIN) refuse(`dsh on PATH is ${dshVersion}, the fixture pins ${PIN} — nothing written`);

const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
const dshRoot = process.env.DSH_PACKAGE_ROOT ?? join(globalRoot, "@deepseek-ai", "dsh");
let manifest;
try {
  manifest = JSON.parse(readFileSync(join(dshRoot, "package.json"), "utf8"));
} catch {
  refuse(`no dsh package manifest at ${dshRoot} (set DSH_PACKAGE_ROOT to the dsh package)`);
}
if (manifest.version !== PIN) refuse(`dsh package at ${dshRoot} is ${manifest.version}, the fixture pins ${PIN} — nothing written`);

const themePath = join(dshRoot, "node_modules", "@deepseek-ai", "dsh-client-ui-theme", "lib", "client.js");
let themeJs;
try {
  themeJs = readFileSync(themePath, "utf8");
} catch {
  refuse(`no theme stylesheet at ${themePath}`);
}

/** `body { … }` light, `body[data-ds-dark-theme] { … }` dark; only `--dsw-alias-*` kept. */
const tokens = {};
const DECLARATION = /--(dsw-alias-[\w-]+)\s*:\s*([^;{}]+)/g;
for (const block of themeJs.matchAll(/body(\[data-ds-dark-theme\])?\{([^{}]*)\}/g)) {
  const dark = block[1] !== undefined;
  for (const declaration of (block[2] ?? "").matchAll(DECLARATION)) {
    const name = declaration[1];
    const value = (declaration[2] ?? "").trim();
    const row = (tokens[name] ??= { light: null, dark: null });
    if (dark) row.dark = value;
    else row.light = value;
  }
}
const names = Object.keys(tokens).sort();
if (names.length === 0) refuse(`no --dsw-alias-* token found in ${themePath}`);

const fixture = {
  pin: PIN,
  verifiedOn: new Date().toISOString().slice(0, 10),
  source: `dsh-client-ui-theme embedded stylesheet (lib/client.js of the dsh at ${dshRoot}); rc.8 ships no src/styles/*.css, the same declarations are embedded as a string`,
  tokenCount: names.length,
  tokens: Object.fromEntries(names.map((name) => [name, tokens[name]])),
};
writeFileSync(FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
console.log(`record-dsw-tokens: wrote ${FIXTURE_PATH} (${names.length} alias tokens, pin ${PIN})`);
