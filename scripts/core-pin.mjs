/**
 * The pin script of the dsh repository (the split, phase 5): the ONE way
 * this repository takes a new core. It is the copy of the plugin
 * repository's `scripts/core-pin.mjs` (the split, phase 4) with the
 * manifest it writes moved to this repository's root — the host package of
 * `specs/120-host-dsh` is built here later by the normal pipeline, and
 * until then the root manifest is the one manifest that pins core. It runs
 * the packer of the core repository, copies the released tarballs into
 * `vendor/core/`, checks their sha256 against the digests the packer
 * recorded, records the pin as `core-pin.json` (version, sha256 of each
 * tarball, the commit of core the tarballs were built from), and writes
 * the tarballs as exact `file:` dependencies of the root manifest.
 *
 * Usage:
 *
 *     node scripts/core-pin.mjs <core-version> <path-to-core>
 *     node scripts/core-pin.mjs --check
 *
 * `--no-deps` records the pin without touching the root manifest. The
 * plugin repository's copy needed it while that repository still held the
 * workspace packages of core; this repository starts pinned and holds no
 * workspace packages, so a pin is normally taken in the default mode —
 * the mode is kept so the two copies stay one script shape.
 *
 * What the script holds (and refuses):
 *
 * - the version argument must be a release version and must equal the root
 *   manifest's version of the core repository and the version of every
 *   tarball the packer released — the operator states what they intend to
 *   pin, and the script refuses a core that does not match the statement;
 * - the core tree must be clean: a pin names the commit the tarballs were
 *   built from, and tarballs built from a dirty tree name a lie;
 * - every digest is recomputed twice — once over the tarball in core's
 *   release directory, once over the copy in `vendor/core/` — and both must
 *   equal the digest the packer recorded, so a pin is only ever taken from
 *   bytes the packer itself attested;
 * - the host needs contracts, host-kit, testkit and the CLI: a release
 *   that lacks one of them is refused, not silently pinned short.
 *
 * `core-pin.json` is committed; the tarballs under `vendor/core/` are not
 * (git-ignored): a fresh clone runs this script against its own core
 * checkout before its first install, which is the flow the dependency rule
 * of the split asks for — a plugin depends on core's packed packages at one
 * exact version, and on nothing else of core.
 *
 * `--check` verifies the recorded pin against the `vendor/core/` bytes and
 * is what the gate of this repository runs before it installs.
 *
 * Every manifest of this repository that pins a `vendor/core` tarball is
 * kept in step with the pin (found by a scan, not by a list, so the next
 * manifest that pins core needs no change here): today that is the root
 * manifest alone. A pin that left a manifest naming an old tarball
 * filename would break the install it just wrote.
 *
 * A re-pin at ONE version replaces the bytes of a tarball whose filename did
 * not change. The lockfile records the integrity of the tarball it installed,
 * and npm serves a `file:` dependency from that record — the install after
 * such a re-pin would silently keep the previous core (found in phase 5: the
 * re-pin at 0.1.0 that scrubbed the staged bundle installed the old bytes).
 * The pin therefore drops the stale reified copies under `node_modules/` and
 * their lockfile entries, so the install that follows it re-packs the
 * vendored tarballs and records the integrity of the bytes this pin holds.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendorDirectory = join(repositoryRoot, "vendor", "core");
const pinFile = join(repositoryRoot, "core-pin.json");
/** The manifest the exact `file:` dependencies are written into: the root manifest, the one manifest that pins core here. */
const ROOT_MANIFEST = join(repositoryRoot, "package.json");
/** The names the host imports at run time (the root manifest's `dependencies`). */
const RUNTIME_NAMES = ["@specstride/contracts", "@specstride/host-kit"];
/** The names only the host's build and tests import (the root manifest's `devDependencies`). */
const DEV_NAMES = ["@specstride/testkit", "specstride"];
const NEEDED_NAMES = [...RUNTIME_NAMES, ...DEV_NAMES];

function refuse(message) {
  process.stderr.write(`core-pin: ${message}\n`);
  process.exit(1);
}

function sha256Of(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** The arguments, as the flag set and the positional list, with unknown flags refused. */
function parseArguments(argv) {
  const flags = new Set();
  const positional = [];
  for (const argument of argv) {
    if (argument.startsWith("--")) {
      if (argument !== "--check" && argument !== "--no-deps") {
        refuse(`unknown flag ${argument} (the script takes --check and --no-deps)`);
      }
      flags.add(argument);
    } else {
      positional.push(argument);
    }
  }
  if (flags.has("--check") && flags.has("--no-deps")) {
    refuse("--check verifies a recorded pin; --no-deps belongs to a pin being taken");
  }
  return { flags, positional };
}

/** The release rows of core's sidecar, with the digests recomputed over core's own bytes. */
function verifiedRelease(coreRoot, version) {
  const releaseDirectory = join(coreRoot, ".build", "release");
  const releaseJson = join(releaseDirectory, "release.json");
  if (!existsSync(releaseJson)) {
    refuse(`core holds no ${join(".build", "release", "release.json")} — did its packer run?`);
  }
  const rows = JSON.parse(readFileSync(releaseJson, "utf8"));
  if (!Array.isArray(rows) || rows.length === 0) {
    refuse("core's release.json holds no tarball row");
  }
  const names = new Set();
  for (const row of rows) {
    if (row.version !== version) {
      refuse(`${row.name}: released at ${row.version}, not the version being pinned (${version})`);
    }
    if (names.has(row.name)) refuse(`core's release.json names ${row.name} twice`);
    names.add(row.name);
    const tarball = join(releaseDirectory, row.file);
    if (!existsSync(tarball)) {
      refuse(`core's release directory holds no ${row.file}`);
    }
    const digest = sha256Of(tarball);
    if (digest !== row.sha256) {
      refuse(
        `${row.file}: the bytes digest to sha256-${digest.slice(0, 12)}…, ` +
          `not the sha256-${row.sha256.slice(0, 12)}… the packer recorded`,
      );
    }
  }
  for (const needed of NEEDED_NAMES) {
    if (!names.has(needed)) {
      refuse(`core released no ${needed} — the plugin cannot pin short of it`);
    }
  }
  return { rows, releaseDirectory };
}

/** The commit of core the tarballs were built from, refused unless its tree is clean. */
function coreCommitOf(coreRoot) {
  const gitDirectory = join(coreRoot, ".git");
  if (!existsSync(gitDirectory)) {
    refuse(`${coreRoot} is not a git checkout — a pin names a commit`);
  }
  const dirty = execFileSync("git", ["-C", coreRoot, "status", "--porcelain"], {
    encoding: "utf8",
  });
  if (dirty.trim() !== "") {
    refuse(
      `the core tree at ${coreRoot} is dirty — commit or stash there first: ` +
        "a pin must name the commit its tarballs were built from",
    );
  }
  return execFileSync("git", ["-C", coreRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

/** The tarballs, copied into `vendor/core/` and re-verified over the copies. */
function vendorTarballs(coreRoot, releaseDirectory, rows) {
  rmSync(vendorDirectory, { recursive: true, force: true });
  mkdirSync(vendorDirectory, { recursive: true });
  const vendored = [];
  for (const row of rows) {
    const target = join(vendorDirectory, row.file);
    copyFileSync(join(releaseDirectory, row.file), target);
    const digest = sha256Of(target);
    if (digest !== row.sha256) {
      refuse(`the copy of ${row.file} in vendor/core digests to ${digest}, not ${row.sha256}`);
    }
    process.stdout.write(`core-pin: vendor/core/${row.file} sha256-${digest}\n`);
    vendored.push({ name: row.name, version: row.version, file: row.file, sha256: digest });
  }
  return vendored;
}

/** The exact `file:` dependency of one pinned row, as the manifest pins it. */
function dependencySpec(row, manifestDirectory) {
  const from = relative(manifestDirectory, vendorDirectory).split("\\").join("/");
  return `file:${from}/${row.file}`;
}

/** The root manifest, with the pinned rows as exact `file:` dependencies. */
function writeDependencies(rows) {
  if (!existsSync(ROOT_MANIFEST)) {
    refuse(`no root manifest at ${ROOT_MANIFEST}`);
  }
  const manifest = JSON.parse(readFileSync(ROOT_MANIFEST, "utf8"));
  const manifestDirectory = dirname(ROOT_MANIFEST);
  const dependencies = { ...(manifest.dependencies ?? {}) };
  const devDependencies = { ...(manifest.devDependencies ?? {}) };
  const rowOfName = new Map(rows.map((row) => [row.name, row]));
  for (const name of RUNTIME_NAMES)
    dependencies[name] = dependencySpec(rowOfName.get(name), manifestDirectory);
  for (const name of DEV_NAMES)
    devDependencies[name] = dependencySpec(rowOfName.get(name), manifestDirectory);
  manifest.dependencies = Object.fromEntries(
    Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b)),
  );
  manifest.devDependencies = Object.fromEntries(
    Object.entries(devDependencies).sort(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(ROOT_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(
    `core-pin: exact file: dependencies written into package.json\n`,
  );
}

/** The tarball filename a `file:` specifier pins, or null when it pins no `vendor/core` tarball. */
function pinnedTarballFile(specifier) {
  if (typeof specifier !== "string" || !specifier.startsWith("file:")) return null;
  const rest = specifier.slice("file:".length);
  return rest.includes("vendor/core/") ? rest.split("/").pop() : null;
}

/** The dependency rows of one manifest, as `[section, name, specifier]` triples. */
function dependencyRowsOf(manifest) {
  const rows = [];
  for (const section of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    for (const [name, specifier] of Object.entries(manifest[section] ?? {})) {
      rows.push([section, name, specifier]);
    }
  }
  return rows;
}

/**
 * Every manifest of this repository that pins a `vendor/core` tarball, found
 * by a scan over the tree rather than by a hard-coded list, so the next
 * manifest that pins core is kept in step with no change to this script.
 */
function discoverPinnedManifests() {
  const SKIP = new Set(["node_modules", "vendor", "old", "specs", "tmp", "plugin", ".build"]);
  const found = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name)) visit(path);
      } else if (entry.name === "package.json") {
        try {
          const manifest = JSON.parse(readFileSync(path, "utf8"));
          if (dependencyRowsOf(manifest).some((row) => pinnedTarballFile(row[2]) !== null)) {
            found.push({ path, manifest });
          }
        } catch {
          // A file named package.json that is no manifest cannot pin a tarball.
        }
      }
    }
  };
  visit(repositoryRoot);
  return found;
}

/**
 * Every discovered manifest is re-pointed at the files this pin records: the
 * dependency KEY names the package, and its `file:` specifier names the
 * tarball of that package in this pin. The root manifest was just written
 * and no-ops here.
 */
function syncPinnedManifests(rows) {
  const fileOfName = new Map(rows.map((row) => [row.name, row.file]));
  for (const { path, manifest } of discoverPinnedManifests()) {
    let changed = false;
    for (const [section, name, specifier] of dependencyRowsOf(manifest)) {
      const current = pinnedTarballFile(specifier);
      const wanted = fileOfName.get(name);
      if (current !== null && wanted !== undefined && current !== wanted) {
        manifest[section][name] = specifier.slice(0, specifier.length - current.length) + wanted;
        changed = true;
      }
    }
    if (changed) {
      writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
      process.stdout.write(
        `core-pin: ${relative(repositoryRoot, path)} re-pointed at the pinned files\n`,
      );
    }
  }
}

/**
 * The stale install of the previous pin: the reified copies of the pinned
 * packages under `node_modules/`, and their lockfile entries, whose recorded
 * integrity would serve the previous bytes. Dropping both is what makes the
 * install after a re-pin take the bytes this pin vendored (default mode
 * only — `--no-deps` records a pin without touching the plugin tree).
 */
function forgetStaleInstall(rows) {
  const lockPath = join(repositoryRoot, "package-lock.json");
  const names = new Set(rows.map((row) => row.name));
  const prefixes = [...names].map((name) => `node_modules/${name}/`);
  if (existsSync(lockPath)) {
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    const packages = lock.packages ?? {};
    let dropped = 0;
    for (const key of Object.keys(packages)) {
      const stripped = key.startsWith("node_modules/") ? key.slice("node_modules/".length) : null;
      if (
        (stripped !== null && names.has(stripped)) ||
        prefixes.some((prefix) => key.startsWith(prefix))
      ) {
        delete packages[key];
        dropped += 1;
      }
    }
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    process.stdout.write(
      `core-pin: ${dropped} stale lockfile entr(y/ies) dropped (the install re-packs the vendored tarballs)\n`,
    );
  }
  for (const name of names) {
    rmSync(join(repositoryRoot, "node_modules", name), { recursive: true, force: true });
  }
  process.stdout.write(
    "core-pin: stale node_modules copies removed — run npm install --ignore-scripts to take this pin\n",
  );
}

/** The recorded pin: the version, the commit of core, the released rows with their digests. */
function writePinFile(version, coreCommit, rows) {
  const pin = { version, coreCommit, packages: rows };
  writeFileSync(pinFile, `${JSON.stringify(pin, null, 2)}\n`);
  process.stdout.write(
    `core-pin: core-pin.json written (version ${version}, core ${coreCommit})\n`,
  );
}

/** `--check`: the recorded pin against the vendor/core bytes, nothing written. */
function checkRecordedPin() {
  if (!existsSync(pinFile)) {
    refuse("no core-pin.json — nothing has been pinned yet");
  }
  const pin = JSON.parse(readFileSync(pinFile, "utf8"));
  if (!/^\d+\.\d+\.\d+$/.test(pin.version ?? "")) {
    refuse(`core-pin.json holds version ${JSON.stringify(pin.version)}, not a release version`);
  }
  if (!/^[0-9a-f]{40}$/.test(pin.coreCommit ?? "")) {
    refuse("core-pin.json holds no core commit");
  }
  const rows = pin.packages;
  if (!Array.isArray(rows) || rows.length === 0) {
    refuse("core-pin.json holds no tarball row");
  }
  for (const row of rows) {
    if (!/^[0-9a-f]{64}$/.test(row.sha256 ?? "")) {
      refuse(`${row.name}: core-pin.json holds no sha256 digest`);
    }
    const tarball = join(vendorDirectory, row.file);
    if (!existsSync(tarball)) {
      refuse(`vendor/core holds no ${row.file} — run the pin against core again`);
    }
    const digest = sha256Of(tarball);
    if (digest !== row.sha256) {
      refuse(
        `${row.file}: vendor/core holds sha256-${digest}, not the recorded sha256-${row.sha256}`,
      );
    }
  }
  for (const needed of NEEDED_NAMES) {
    if (!rows.some((row) => row.name === needed)) {
      refuse(`core-pin.json holds no ${needed} — the plugin cannot be pinned short of it`);
    }
  }
  const recordedFiles = new Set(rows.map((row) => row.file));
  for (const { path, manifest } of discoverPinnedManifests()) {
    for (const [section, name, specifier] of dependencyRowsOf(manifest)) {
      const file = pinnedTarballFile(specifier);
      if (file !== null && !recordedFiles.has(file)) {
        refuse(
          `${relative(repositoryRoot, path)} pins ${file} for ${name} (${section}), ` +
            "which the recorded pin does not hold — run the pin again",
        );
      }
    }
  }
  process.stdout.write(
    `core-pin: ok ${rows.length} tarball(s) of core ${pin.version} at ${pin.coreCommit.slice(0, 12)}\n`,
  );
}

const { flags, positional } = parseArguments(process.argv.slice(2));

if (flags.has("--check")) {
  if (positional.length !== 0) {
    refuse("--check takes no argument (it verifies the recorded pin)");
  }
  checkRecordedPin();
} else {
  if (positional.length !== 2) {
    refuse("usage: node scripts/core-pin.mjs <core-version> <path-to-core> [--no-deps]");
  }
  const [version, coreArgument] = positional;
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    refuse(`${JSON.stringify(version)} is not a release version (X.Y.Z)`);
  }
  const coreRoot = resolve(coreArgument);
  const coreManifestPath = join(coreRoot, "package.json");
  const packer = join(coreRoot, "scripts", "pack-release.mjs");
  if (!existsSync(coreManifestPath) || !existsSync(packer)) {
    refuse(`${coreRoot} holds no package.json and no scripts/pack-release.mjs — is it core?`);
  }
  const coreVersion = JSON.parse(readFileSync(coreManifestPath, "utf8")).version;
  if (coreVersion !== version) {
    refuse(`core's root manifest is at ${coreVersion}, not the ${version} being pinned`);
  }
  const coreCommit = coreCommitOf(coreRoot);

  // The pack: core packs its own release (its staging writers run inside it),
  // so the bytes a plugin pins are the bytes a version publishes.
  execFileSync(process.execPath, [packer], { cwd: coreRoot, stdio: "inherit" });
  const { rows, releaseDirectory } = verifiedRelease(coreRoot, version);
  process.stdout.write(
    `core-pin: core ${version} at ${coreCommit.slice(0, 12)} released ${rows.length} tarball(s)\n`,
  );

  const vendored = vendorTarballs(coreRoot, releaseDirectory, rows);
  writePinFile(version, coreCommit, vendored);
  if (flags.has("--no-deps")) {
    process.stdout.write(
      "core-pin: --no-deps: the root manifest is untouched (record only)\n",
    );
  } else {
    writeDependencies(vendored);
    syncPinnedManifests(vendored);
    forgetStaleInstall(vendored);
  }
}
