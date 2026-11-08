/**
 * The installer and the uninstaller (T026, F120-FR-020, F120-FR-021;
 * research.md R8; data-model §3–§4).
 *
 * Scopes are the closed set `dsh-install-scopes` of
 * `specs/120-host-dsh/contracts/closed-sets.json`: `user` (`$DSH_HOME/skills`,
 * the default), `project` (`<projectRoot>/.dsh/skills`), `shared`
 * (`~/.agents/skills`). The other two scanned roots
 * (`<projectRoot>/.agents/skills`, `customSkillDirs`) are never install
 * targets; an unknown scope refuses.
 *
 * Per target directory the state machine of data-model §4:
 *   absent → installed                (write files, then the record)
 *   installed + unchanged → installed (no byte changes — idempotent)
 *   installed + changed → refused     (one line naming the file)
 *   present, not ours → refused       (no record names it)
 *
 * The record `<root>/.specstride-host-dsh-install.json` (dsh's scanner reads
 * only `<name>/SKILL.md`, so the dot-prefixed name is ignored by dsh) is
 * written atomically — temp file + rename (constitution I). Its fields per
 * data-model §4, including `skills` rows carrying the kit `skillContentHash`
 * and per-file sha256. The installer writes `metadata.version` into each
 * installed SKILL.md frontmatter so `host.skills-installed` can read
 * staleness without the record (F120-FR-016).
 *
 * The uninstaller removes the recorded files whose hash still matches, keeps
 * and reports changed ones, and removes the record last (F120-FR-021).
 *
 * It installs and updates no CLI: the kit's `INSTALLS_OR_UPDATES_THE_CLI` is
 * asserted false at load. The installer ships the build's rendered output
 * (`skills/`) and renders nothing at install (F120-FR-018); it never writes
 * outside the chosen root and runs no CLI command.
 */
import {
  createHash,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { skillContentHash, INSTALLS_OR_UPDATES_THE_CLI } from "@specstride/host-kit";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
const RECORD_FILENAME = ".specstride-host-dsh-install.json";

/** The kit declares this host installs and updates no CLI. */
if (INSTALLS_OR_UPDATES_THE_CLI !== false) {
  throw new Error("INSTALLS_OR_UPDATES_THE_CLI must be false — the installer touches no CLI");
}

/* -------------------------------------------------------------------------
 * The closed set of scopes (owner 120)
 * ---------------------------------------------------------------------- */

const CLOSED_SETS = JSON.parse(
  readFileSync(
    join(ROOT, "contracts", "closed-sets.json"),
    "utf8",
  ),
) as { proposedByFeature: { id: string; members: { scope: string; root: string }[] }[] };

/** The closed set `dsh-install-scopes` (owner 120), read at load. */
export const INSTALL_SCOPES: ReadonlyMap<string, string> = new Map(
  CLOSED_SETS.proposedByFeature
    .find((row) => row.id === "dsh-install-scopes")!
    .members.map((member) => [member.scope, member.root]),
);

/** The logical ids of the set the installer installs (engine row 144). */
export const INSTALL_LOGICAL_IDS: readonly string[] = Object.freeze([
  "specstride-run",
  "specstride-reverse",
  "doctor",
]);

/** The spellings, from the closed set `dsh-skill-spellings` (directory names). */
const SPELLINGS: readonly string[] = Object.freeze([
  "specstride-run",
  "specstride-reverse",
  "specstride-doctor",
]);

/* -------------------------------------------------------------------------
 * Manifest facts, read once — declared once (F120-FR-012, F120-FR-022)
 * ---------------------------------------------------------------------- */

type Manifest = {
  name: string;
  version: string;
  specstride?: { engineVersion?: string };
};

function readManifest(): Manifest {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as Manifest;
}

function readKitVersion(): string {
  const kit = JSON.parse(
    readFileSync(
      join(ROOT, "node_modules", "@specstride", "host-kit", "package.json"),
      "utf8",
    ),
  ) as { version?: string };
  if (typeof kit.version !== "string") {
    throw new Error("the pinned @specstride/host-kit carries no version");
  }
  return kit.version;
}

/* -------------------------------------------------------------------------
 * Scope resolution — one root per install, closed set
 * ---------------------------------------------------------------------- */

export type Scope = "user" | "project" | "shared";

export type ScopeResolution =
  | { readonly ok: true; readonly scope: Scope; readonly root: string }
  | { readonly ok: false; readonly line: string };

/**
 * Parse the scope flags: default `user`; `--project`; `--shared`; combining
 * them refuses; `--scope=<value>` outside the closed set refuses; the root is
 * resolved against the given environment (never the caller's real root when
 * the tests set temporary variables — F120-FR-020).
 */
export function resolveScope(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): ScopeResolution {
  let scope: Scope | null = null;
  for (const arg of args) {
    if (arg === "--project") {
      if (scope !== null && scope !== "project") {
        return { ok: false, line: "specstride-host-dsh install: refuse — combine at most one of --project and --shared (one root per install)" };
      }
      scope = "project";
    } else if (arg === "--shared") {
      if (scope !== null && scope !== "shared") {
        return { ok: false, line: "specstride-host-dsh install: refuse — combine at most one of --project and --shared (one root per install)" };
      }
      scope = "shared";
    } else if (arg.startsWith("--scope=")) {
      const asked = arg.slice("--scope=".length);
      if (!INSTALL_SCOPES.has(asked)) {
        return {
          ok: false,
          line: `specstride-host-dsh install: refuse — unknown scope "${asked}" (the closed set: ${[...INSTALL_SCOPES.keys()].join(", ")})`,
        };
      }
      scope = asked as Scope;
    }
  }
  const chosen = scope ?? "user"; // default scope: user
  const template = INSTALL_SCOPES.get(chosen)!;
  const base =
    chosen === "user"
      ? env.DSH_HOME
      : chosen === "project"
        ? (env.PROJECT_ROOT ?? process.cwd())
        : env.HOME;
  if (base === undefined || base === "") {
    return {
      ok: false,
      line: `specstride-host-dsh install: refuse — scope "${chosen}" needs ${chosen === "user" ? "DSH_HOME" : chosen === "project" ? "PROJECT_ROOT (or a working directory)" : "HOME"} set`,
    };
  }
  const root = template
    .replace("$DSH_HOME", env.DSH_HOME ?? "")
    .replace("<projectRoot>", env.PROJECT_ROOT ?? process.cwd())
    .replace("~", env.HOME ?? "");
  return { ok: true, scope: chosen, root };
}

/* -------------------------------------------------------------------------
 * Hashing
 * ---------------------------------------------------------------------- */

function sha256Of(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * The bytes installed for a skill: the shipped rendered file with
 * `metadata.version` inserted into the frontmatter (data-model §4). The
 * shipped artifact is the build's rendered output — the installer renders
 * nothing (F120-FR-018).
 */
export function installedBytesFor(shippedPath: string, packageVersion: string): string {
  const text = readFileSync(shippedPath, "utf8");
  if (!/^metadata:\n  version: /m.test(text)) {
    const end = text.indexOf("\n---\n");
    if (end === -1) {
      throw new Error(`${shippedPath}: no frontmatter block to carry metadata.version`);
    }
    return `${text.slice(0, end)}\nmetadata:\n  version: ${packageVersion}${text.slice(end)}`;
  }
  return text;
}

/* -------------------------------------------------------------------------
 * The install record (data-model §4)
 * ---------------------------------------------------------------------- */

export type InstallRecord = {
  package: { name: string; version: string };
  engineVersion: string;
  kitVersion: string;
  scope: Scope;
  root: string;
  skills: Record<
    string,
    { directory: string; contentHash: string; files: { path: string; sha256: string }[] }
  >;
  installedAt: string;
};

function readRecord(root: string): InstallRecord | null {
  const path = join(root, RECORD_FILENAME);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as InstallRecord;
}

/** Atomic write: temp file + rename in the same directory (constitution I). */
function writeRecordAtomic(record: InstallRecord): void {
  const target = join(record.root, RECORD_FILENAME);
  const temp = join(record.root, `${RECORD_FILENAME}.tmp-${process.pid}`);
  writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  renameSync(temp, target);
}

/* -------------------------------------------------------------------------
 * Reading the shipped tree
 * ---------------------------------------------------------------------- */

function walkFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

export type SkillPlan = {
  logicalId: string;
  directory: string;
  contentHash: string;
  files: { relativePath: string; bytes: string }[];
};

/** Plan the three skill directories from the shipped rendered output. */
export function planInstall(): { package: Manifest; kitVersion: string; skills: SkillPlan[] } {
  const manifest = readManifest();
  const kitVersion = readKitVersion();
  const skillsDirectory = join(ROOT, "skills");
  const skills: SkillPlan[] = [];
  for (const [index, spelling] of SPELLINGS.entries()) {
    const logicalId = INSTALL_LOGICAL_IDS[index]!;
    const directory = join(skillsDirectory, spelling);
    if (!existsSync(directory)) {
      throw new Error(`skills/${spelling} is missing — run npm run build first (the installer ships the build's rendered output)`);
    }
    const files: { relativePath: string; bytes: string }[] = [];
    let contentHash = "";
    for (const path of walkFiles(directory)) {
      const relativePath = relative(directory, path).split(sep).join("/");
      const bytes =
        relativePath === "SKILL.md"
          ? installedBytesFor(path, manifest.version)
          : readFileSync(path, "utf8");
      if (relativePath === "SKILL.md") contentHash = skillContentHash(bytes);
      files.push({ relativePath, bytes });
    }
    skills.push({ logicalId, directory: spelling, contentHash, files });
  }
  return { package: manifest, kitVersion, skills };
}

/* -------------------------------------------------------------------------
 * The installer
 * ---------------------------------------------------------------------- */

export type InstallOutcome = {
  code: number;
  lines: readonly string[];
};

export function install(env: NodeJS.ProcessEnv, args: readonly string[]): InstallOutcome {
  const resolution = resolveScope(args, env);
  if (!resolution.ok) return { code: 1, lines: [resolution.line] };
  const { scope, root } = resolution;
  const record = readRecord(root);
  const planned = planInstall();

  if (record !== null) {
    // `installed`: every recorded file must still match its sha256.
    if (record.root !== root || record.scope !== scope) {
      return {
        code: 1,
        lines: [
          `specstride-host-dsh install: refuse — the record of ${root} describes scope "${record.scope}", not "${scope}"`,
        ],
      };
    }
    const recorded = new Map<string, string>();
    for (const row of Object.values(record.skills)) {
      for (const file of row.files) recorded.set(file.path, file.sha256);
    }
    for (const [path, sha256] of recorded) {
      const absolute = join(root, path);
      if (!existsSync(absolute) || sha256Of(absolute) !== sha256) {
        return {
          code: 1,
          lines: [
            `specstride-host-dsh install: refuse — ${path} differs from the recorded sha256; restore or remove it by hand, then install again`,
          ],
        };
      }
    }
    return { code: 0, lines: ["already installed, unchanged"] };
  }

  // No record: every target directory that exists is foreign content.
  for (const skill of planned.skills) {
    const target = join(root, skill.directory);
    if (existsSync(target)) {
      return {
        code: 1,
        lines: [
          `specstride-host-dsh install: refuse — ${relative(root, target).split(sep).join("/")} exists but no record describes it; remove the directory by hand, then install again`,
        ],
      };
    }
  }

  // `absent` → write the files, then the record (atomic).
  mkdirSync(root, { recursive: true });
  const newRecord: InstallRecord = {
    package: { name: planned.package.name, version: planned.package.version },
    engineVersion: planned.package.specstride!.engineVersion!,
    kitVersion: planned.kitVersion,
    scope,
    root,
    skills: {},
    installedAt: new Date().toISOString(),
  };
  for (const skill of planned.skills) {
    const target = join(root, skill.directory);
    mkdirSync(target, { recursive: true });
    const files: { path: string; sha256: string }[] = [];
    for (const file of skill.files) {
      const path = join(target, file.relativePath);
      writeFileSync(path, file.bytes, "utf8");
      files.push({ path: `${skill.directory}/${file.relativePath}`, sha256: sha256Of(path) });
    }
    newRecord.skills[skill.logicalId] = {
      directory: skill.directory,
      contentHash: skill.contentHash,
      files,
    };
  }
  writeRecordAtomic(newRecord);
  return {
    code: 0,
    lines: planned.skills.map((skill) => `installed ${skill.directory} (${scope}: ${root})`),
  };
}

/* -------------------------------------------------------------------------
 * The uninstaller
 * ---------------------------------------------------------------------- */

export function uninstall(env: NodeJS.ProcessEnv, args: readonly string[]): InstallOutcome {
  const resolution = resolveScope(args, env);
  if (!resolution.ok) return { code: 1, lines: [resolution.line] };
  const { root } = resolution;
  const record = readRecord(root);
  if (record === null) {
    return {
      code: 1,
      lines: [
        `specstride-host-dsh uninstall: refuse — no install record in ${root}; nothing to remove`,
      ],
    };
  }
  const lines: string[] = [];
  const recordPath = join(root, RECORD_FILENAME);
  // Remove the matching-hash files first; keep and report changed ones.
  for (const [logicalId, row] of Object.entries(record.skills)) {
    void logicalId;
    const directories = new Set<string>();
    for (const file of row.files) {
      const absolute = join(root, file.path);
      if (!existsSync(absolute)) continue;
      if (sha256Of(absolute) !== file.sha256) {
        lines.push(`kept ${file.path} — it differs from the recorded sha256 (changed after install)`);
        continue;
      }
      unlinkSync(absolute);
      directories.add(dirname(join(root, file.path)));
    }
    // Remove the directories this package wrote, deepest first, only if empty.
    for (const directory of [...directories].sort().reverse()) {
      removeIfEmpty(directory, root);
    }
  }
  // The record is removed last.
  if (existsSync(recordPath)) rmSync(recordPath);
  removeIfEmpty(root, root);
  if (lines.length === 0) {
    lines.push(`removed the install of ${root}`);
  }
  return { code: 0, lines };
}

function removeIfEmpty(directory: string, stop: string): void {
  let current = directory;
  while (current.startsWith(stop) && current !== dirname(stop)) {
    try {
      if (readdirSync(current).length > 0) return;
      rmdir(current);
    } catch {
      return;
    }
    current = dirname(current);
  }
}

function rmdir(path: string): void {
  rmdirSync(path);
}

/* -------------------------------------------------------------------------
 * The command entry points the control CLI wires (T027)
 * ---------------------------------------------------------------------- */

/** One line per effect on stdout; refusals as ONE line on stderr (F120-FR-014). */
export function installMain(env: NodeJS.ProcessEnv, args: readonly string[]): number {
  const outcome = install(env, args);
  for (const line of outcome.lines) {
    if (outcome.code === 0) console.log(line);
    else console.error(line);
  }
  return outcome.code;
}

export function uninstallMain(env: NodeJS.ProcessEnv, args: readonly string[]): number {
  const outcome = uninstall(env, args);
  for (const line of outcome.lines) {
    if (outcome.code === 0) console.log(line);
    else console.error(line);
  }
  return outcome.code;
}

/** The record filename, for the tests and the doctor. */
export const INSTALL_RECORD_FILENAME = RECORD_FILENAME;
