/**
 * The six dsh host checks and the doctor runner (T020, F120-FR-016,
 * F120-FR-017, F120-FR-029; research.md R7 — G-A). Every check is an object
 * in the kit `DoctorCheck` shape (`@specstride/contracts/ep/doctor`), in the
 * closed-set order of `specs/120-host-dsh/contracts/closed-sets.json`
 * (`dsh-host-checks`). Facts are read from `src/host-facts.ts` — the
 * dsh-version range, the permission-mode semantics, the no-approver fact —
 * and never restated here. A check reads and never writes, makes no paid
 * call, prints no secret value; a check that throws is a `fail` and the
 * doctor exits with the kit's throwing exit; an unknown id in a filter exits
 * with the kit's usage-error exit. Exit codes come from the kit
 * `DOCTOR_EXITS` (annex G §G.4), read at load — never restated.
 *
 * Findings print one per line as `<severity> <check> — <fix>` (the kit doctor
 * body's grammar); `--json` prints the EP-14 finding shape
 * (`specstride.doctor/1`, F120-FR-014 allows it here). Findings approve
 * nothing (constitution II); the command-roster fact prints `unverified`
 * until its settling check runs — no check claims a pass it cannot ground
 * (constitution XVII).
 */
import {
  DOCTOR_EXITS,
  SEVERITY_WHEN_NOT_OBSERVED,
  protocolSupportedCheck,
} from "@specstride/host-kit";
import { resolveExecutable, readProtocol } from "@specstride/host-kit/shim";
import {
  EXIT_WHEN_A_CHECK_THROWS,
  UNKNOWN_CHECK_ID_IN_A_FILTER_EXIT_CODE,
  SCHEMA_ID as FINDINGS_SCHEMA_ID,
  type DoctorCheck,
  type DoctorFinding,
  type Severity,
} from "@specstride/contracts/ep/doctor";
import {
  SCHEMA_ID,
  summaryOf,
  type Audience,
  type Finding,
} from "@specstride/contracts/records/doctor-findings";
import {
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  unlinkSync,
  accessSync,
  statSync,
  constants as fsConstants,
} from "node:fs";
import { execFile as nodeExecFile } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DSH_VERSION_RANGE, DSH_VERSION_PIN, dshHostFacts } from "./host-facts.ts";
import { dshInstallCommand } from "./shim.ts";
import { packageFile, packageRootOf } from "./package-root.ts";

const ROOT = packageRootOf(import.meta.url);
const CLOSED_SETS = JSON.parse(
  readFileSync(
    packageFile(ROOT, join("contracts", "closed-sets.json")),
    "utf8",
  ),
) as { proposedByFeature: { id: string; members: string[] }[] };

/** The closed set `dsh-host-checks`, in its order (owner 120). */
export const DSH_HOST_CHECK_IDS: readonly string[] = Object.freeze(
  CLOSED_SETS.proposedByFeature.find((row) => row.id === "dsh-host-checks")!
    .members,
);

/** The three skill spellings `host.skills-installed` looks for. */
const SKILL_SPELLINGS: readonly string[] = Object.freeze([
  "specstride-run",
  "specstride-reverse",
  "specstride-doctor",
]);

/** The unverified clause of the writable-root alternative (host-facts). */
const WRITABLE_ROOT_CLAUSE =
  "or a writable root that includes the state home, where the installed dsh supports one (unverified)";

/**
 * The fix line of `host.state-root-writable`: exactly
 * `DSH_PERMISSION_MODE=danger-full-access` first, then the unverified
 * writable-root clause; never an offer to move state into the working tree.
 */
export const DSH_STATE_ROOT_FIX =
  `DSH_PERMISSION_MODE=danger-full-access, ${WRITABLE_ROOT_CLAUSE}`;

/** The no-approver fact, read from the host-facts table (R4 F11). */
const NO_APPROVER_FACT =
  dshHostFacts.find((row) => /no approver/.test(row.fact))?.fact ??
  "headless has no approver";

/** The command-roster fact: unverified until its settling check runs. */
const COMMAND_ROSTER_UNVERIFIED =
  "command-roster visibility: unverified (HF-13, settling check pending)";

export type SkillsInstalledObservation = {
  /** Skill directories absent from every scanned root. */
  readonly missing: readonly string[];
  /** Skill directories present but not at this package's version. */
  readonly stale: readonly string[];
  /** Copies shadowed by a higher-rank root, with the shadowing root named. */
  readonly shadowed: readonly {
    name: string;
    root: string;
    version: string;
  }[];
  /**
   * Whether the shim the skills call by name (`specstride-dsh`, this
   * package's bin) is an executable on PATH. Absent when not observed.
   */
  readonly shimOnPath?: boolean;
};

/** The shim's bin name: the skills run every `specstride <cmd>` as `specstride-dsh <cmd>`. */
export const SHIM_BIN = "specstride-dsh";

export type PermissionModeObservation = {
  /** `DSH_PERMISSION_MODE` in force (default `workspace-write`, rc.8). */
  readonly mode: string;
  /** Whether an approval can be answered in this session. */
  readonly approval: "answerable" | "no-approver";
};

/**
 * The `host.kanban-plugin` observation (F121-FR-019; research.md R11): what
 * `$DSH_HOME/profiles/web/package.json` pins for `@specstride/dsh-kanban`,
 * and the server half's start state. `serverHalf` is `started` only from the
 * server half's own start line where dsh exposes a log — never assumed
 * (Principle XIV); the collector reports `unknown` until that surface exists.
 */
export type KanbanPluginObservation = {
  readonly installed: boolean;
  /** The raw spec string in the profile manifest, when installed. */
  readonly spec?: string;
  /** True only for an exact pin (`<version>` with no range operator). */
  readonly exact: boolean;
  readonly serverHalf: "started" | "unknown";
};

/** The plugin package the check looks for (the plugin's provisional name). */
export const KANBAN_PLUGIN_NAME = "@specstride/dsh-kanban";


export type DshObservations = {
  readonly "cli-found"?: CliObservation;
  readonly protocol?: number | null;
  readonly "dsh-version"?: string | null;
  readonly "skills-installed"?: SkillsInstalledObservation;
  readonly "state-root-writable"?: "writable" | "blocked" | "unverified";
  readonly "permission-mode"?: PermissionModeObservation;
  readonly "kanban-plugin"?: KanbanPluginObservation;
};

/* -------------------------------------------------------------------------
 * The dsh-version range, read from the host-facts table
 * ---------------------------------------------------------------------- */

/** Compare two `0.x.y-rc.n` versions the way the recorded range orders them. */
export function compareDshVersions(a: string, b: string): number {
  const parse = (v: string): [number, number, number, string, number] => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-(rc)\.(\d+))?$/.exec(v.trim());
    if (m === null) return [0, 0, 0, "", -1];
    return [
      Number(m[1]),
      Number(m[2]),
      Number(m[3]),
      m[4] ?? "",
      m[5] === undefined ? Number.POSITIVE_INFINITY : Number(m[5]),
    ];
  };
  const [a1, a2, a3, aPre, aN] = parse(a);
  const [b1, b2, b3, bPre, bN] = parse(b);
  for (const [x, y] of [
    [a1, b1],
    [a2, b2],
    [a3, b3],
  ]) {
    if (x !== y) return x < y ? -1 : 1;
  }
  // A pre-release sorts before its release; rc numbers order among themselves.
  if (aPre === "" && bPre === "") return 0;
  if (aPre === "") return 1;
  if (bPre === "") return -1;
  return aN === bN ? 0 : aN < bN ? -1 : 1;
}

/**
 * True when `version` sits inside the recorded range
 * `>=0.1.0-rc.8 <0.1.0` (read from `src/host-facts.ts`, never restated).
 */
export function dshVersionInRange(version: string): boolean {
  const lower = DSH_VERSION_RANGE.startsWith(">=")
    ? DSH_VERSION_RANGE.slice(2).split(" ")[0]
    : null;
  const upper = DSH_VERSION_RANGE.includes(" <")
    ? DSH_VERSION_RANGE.split(" <")[1]
    : null;
  if (lower !== null && compareDshVersions(version, lower) < 0) return false;
  if (upper !== null && compareDshVersions(version, upper) >= 0) return false;
  return true;
}

/* -------------------------------------------------------------------------
 * The six checks
 * ---------------------------------------------------------------------- */

/** A check a severity rule of this module can name, frozen once. */
function dshCheck(check: DoctorCheck): DoctorCheck {
  if (Buffer.byteLength(check.messageTemplate, "utf8") > 200) {
    throw new Error(`${check.id}: messageTemplate over the 200-byte cap`);
  }
  return Object.freeze(check);
}

/** The severity of a check nobody observed yet: a warning, never a failure. */
function unobserved(observed: unknown, decided: () => Severity): Severity {
  return observed === undefined || observed === null
    ? SEVERITY_WHEN_NOT_OBSERVED
    : decided();
}

/**
 * The six dsh host checks, in the closed-set order of `closed-sets.json`:
 * `host.cli-found` (rebuilt in the kit shape — the fix is the install command
 * version-inlined from the pinned release, printed never run; the only `lb`),
 * `host.protocol-supported` (the kit `protocolSupportedCheck()` reused
 * verbatim), `host.dsh-version`, `host.skills-installed`,
 * `host.state-root-writable`, `host.permission-mode`.
 */
export function dshDoctorChecks(engineVersion: string): readonly DoctorCheck[] {
  const installCommand = dshInstallCommand(engineVersion);
  const checks: DoctorCheck[] = [
    // 1 — the only launch check of the doctor.
    dshCheck({
      id: "host.cli-found",
      // A `specstride` that does not answer `--protocol` is not a Specstride
      // CLI the shim can use: every launch refuses with `found=none`, so the
      // one launch check fails too, and its fix names that executable.
      severityRule: (observed) =>
        unobserved(observed, () => (cliUsable(observed) ? "ok" : "fail")),
      lb: true,
      order: 1,
      probe: (injected) => Promise.resolve(injected["cli-found"]),
      messageTemplate: "the Specstride CLI is {state} on this machine",
      fixHint: installCommand, // printed, never run (F120-FR-011)
    }),
    // 2 — the kit builder reused verbatim (host-neutral template and fix).
    dshCheck(protocolSupportedCheck()),
    // 3 — the range read from src/host-facts.ts; past it warns, nothing stops.
    dshCheck({
      id: "host.dsh-version",
      severityRule: (observed) =>
        unobserved(observed, () =>
          typeof observed === "string" && dshVersionInRange(observed)
            ? "ok"
            : "warn",
        ),
      lb: false,
      order: 3,
      probe: (injected) => Promise.resolve(injected["dsh-version"]),
      messageTemplate: "dsh on this machine reports version {state}",
      fixHint: `upgrade or pin dsh to the tested release (${DSH_VERSION_PIN}); nothing stops past the range ${DSH_VERSION_RANGE}`,
    }),
    // 4 — three directories, unshadowed, at this package's version.
    dshCheck({
      id: "host.skills-installed",
      severityRule: (observed) => {
        const o = observed as SkillsInstalledObservation | undefined | null;
        if (o === undefined || o === null) return SEVERITY_WHEN_NOT_OBSERVED;
        if (o.missing.length > 0 || o.shimOnPath === false) return "fail";
        if (o.stale.length > 0 || o.shadowed.length > 0) return "warn";
        return "ok";
      },
      lb: false,
      order: 4,
      probe: (injected) => Promise.resolve(injected["skills-installed"]),
      messageTemplate: "the three dsh skills are installed {state}",
      fixHint:
        "install the missing or stale scope with `specstride-host-dsh install`; the shadowing root is named in the finding when one exists",
    }),
    // 5 — probe file under $XDG_STATE_HOME/specstride/, then removed.
    dshCheck({
      id: "host.state-root-writable",
      severityRule: (observed) =>
        unobserved(observed, () => (observed === "writable" ? "ok" : "warn")),
      lb: false,
      order: 5,
      probe: (injected) => Promise.resolve(injected["state-root-writable"]),
      messageTemplate: "the state home of dsh is {state} to this process",
      fixHint: DSH_STATE_ROOT_FIX,
    }),
    // 6 — mode in force + whether an approval can be answered.
    dshCheck({
      id: "host.permission-mode",
      severityRule: (observed) => {
        const o = observed as PermissionModeObservation | undefined | null;
        if (o === undefined || o === null) return SEVERITY_WHEN_NOT_OBSERVED;
        if (o.approval === "no-approver") return "warn";
        return o.mode === "danger-full-access" ? "ok" : "info";
      },
      lb: false,
      order: 6,
      probe: (injected) => Promise.resolve(injected["permission-mode"]),
      messageTemplate: "the permission mode in force is {state}",
      fixHint:
        "none required; the finding is what specstride-run states when host.state-root-writable warned",
    }),
    // 7 — the kanban plugin in the web profile (added by 121, F121-FR-019):
    // reads the profile manifest only; never a launch check; `serverHalf`
    // is `unknown` unless the server half's own start line was seen.
    dshCheck({
      id: "host.kanban-plugin",
      severityRule: (observed) => {
        const o = observed as KanbanPluginObservation | undefined | null;
        if (o === undefined || o === null) return SEVERITY_WHEN_NOT_OBSERVED;
        if (!o.installed) return "info"; // 120 ships without the plugin
        return o.exact ? "ok" : "warn";
      },
      lb: false,
      order: 7,
      probe: (injected) => Promise.resolve(injected["kanban-plugin"]),
      messageTemplate: "the Kanban plugin in the web profile is {state}",
      fixHint:
        "install with `dsh plugin --profile web add @specstride/dsh-kanban --save-exact`; re-pin a range spec with `--save-exact`",
    }),
  ];
  const ids = checks.map((check) => check.id);
  if (ids.join(",") !== DSH_HOST_CHECK_IDS.join(",")) {
    throw new Error(
      `the doctor checks are not the closed set in order: ${ids.join(", ")}`,
    );
  }
  return Object.freeze(checks);
}

/* -------------------------------------------------------------------------
 * The runner
 * ---------------------------------------------------------------------- */

export type DoctorRunResult = {
  readonly findings: readonly DoctorFinding[];
  /** One line per finding, in the kit doctor body's grammar. */
  readonly output: string;
  readonly exit: number;
  /** True when at least one check threw (the doctor then exits 1). */
  readonly thrown: boolean;
  /** The `--json` record, when asked for. */
  readonly json?: string;
};

/**
 * Run checks over the observations. A check that throws yields a `fail`
 * finding and makes the doctor exit with the kit's throwing exit; nothing
 * here approves anything and nothing here writes.
 */
export async function runDoctorFindings(
  checks: readonly DoctorCheck[],
  observations: DshObservations,
): Promise<{
  findings: DoctorFinding[];
  exit: number;
  thrown: boolean;
}> {
  const findings: DoctorFinding[] = [];
  let thrown = false;
  for (const check of checks) {
    let observed: unknown;
    let severity: Severity;
    try {
      observed = await check.probe(
        observations as Readonly<Record<string, unknown>>,
      );
      severity = check.severityRule(observed);
    } catch (error) {
      thrown = true;
      findings.push({
        id: check.id,
        severity: "fail",
        lb: check.lb,
        message: `the check ${check.id} could not run: ${
          error instanceof Error ? error.message : String(error)
        }`,
        fix: "run the doctor again; if it still throws, report the error",
        evidence: "probe threw",
      });
      continue;
    }
    const state =
      observed === undefined || observed === null
        ? "not observed"
        : typeof observed === "boolean"
          ? observed
            ? "present"
            : "absent"
          : typeof observed === "object"
            ? describeObservation(check.id, observed)
            : String(observed);
    findings.push({
      id: check.id,
      severity,
      lb: check.lb,
      message: check.messageTemplate.replace("{state}", state),
      fix: fixOf(check, observed),
      evidence: evidenceOf(check.id, observed),
    });
  }
  const exit = thrown
    ? EXIT_WHEN_A_CHECK_THROWS
    : findings.some((f) => f.severity === "fail")
      ? exitForMeaning("at least one")
      : exitForMeaning("no `fail` finding");
  return { findings, exit, thrown };
}

/** The exit code whose annex-G §G.4 meaning names the given phrase. */
function exitForMeaning(phrase: string): number {
  const exit = DOCTOR_EXITS.find((exit) => exit.meaning.includes(phrase));
  if (exit === undefined) {
    throw new Error(`annex G §G.4 names no exit for: ${phrase}`);
  }
  return exit.code;
}

/**
 * `host.cli-found` is observed as a boolean (injected, or no executable at
 * all) or as the executable the shim would run and whether it answers
 * `--protocol`.
 */
export type CliObservation = boolean | { path: string; answersProtocol: boolean };

function cliUsable(observed: unknown): boolean {
  if (typeof observed === "boolean") return observed;
  const o = observed as { path?: unknown; answersProtocol?: unknown };
  return typeof o.path === "string" && o.answersProtocol === true;
}

/** The printed fix: the check's own, except where the observation names more. */
function fixOf(check: DoctorCheck, observed: unknown): string {
  if (check.id === "host.skills-installed" && typeof observed === "object" && observed !== null) {
    const o = observed as SkillsInstalledObservation;
    if (o.missing.length === 0 && o.shimOnPath === false) {
      return `the skills run \`${SHIM_BIN} <cmd>\`, which is not on PATH: install this package globally (npm install -g <the packed @specstride/host-dsh tarball>) so its ${SHIM_BIN} bin is on the PATH dsh runs with`;
    }
  }
  if (check.id === "host.cli-found" && typeof observed === "object" && observed !== null) {
    const o = observed as { path: string; answersProtocol: boolean };
    if (!o.answersProtocol) {
      return `${o.path} answers no --protocol (no protocol-speaking Specstride engine): set SPECSTRIDE_BIN to the engine of the pin, or install it with ${check.fixHint}`;
    }
  }
  return check.fixHint;
}

function describeObservation(id: string, observed: unknown): string {
  if (id === "host.cli-found") {
    const o = observed as { path: string; answersProtocol: boolean };
    return o.answersProtocol ? `found at ${o.path}` : `not found (${o.path} answers no --protocol)`;
  }
  if (id === "host.skills-installed") {
    const o = observed as SkillsInstalledObservation;
    const parts: string[] = [];
    if (o.missing.length > 0) parts.push(`missing: ${o.missing.join(", ")}`);
    if (o.stale.length > 0) parts.push(`stale: ${o.stale.join(", ")}`);
    if (o.shimOnPath === false) parts.push(`${SHIM_BIN} not on PATH`);
    for (const shadow of o.shadowed) {
      parts.push(
        `shadowed: ${shadow.name} (version ${shadow.version}) under ${shadow.root}`,
      );
    }
    return parts.length > 0 ? parts.join("; ") : "in one root, current";
  }
  if (id === "host.permission-mode") {
    const o = observed as PermissionModeObservation;
    return o.approval === "no-approver"
      ? `${o.mode} (headless — ${NO_APPROVER_FACT.toLowerCase()})`
      : o.mode;
  }
  if (id === "host.kanban-plugin") {
    const o = observed as KanbanPluginObservation;
    if (!o.installed) return "not installed";
    return `installed ${o.spec ?? "(unknown version)"}${
      o.exact ? " (exact)" : " (range — re-pin with --save-exact)"
    }; server half ${o.serverHalf}`;
  }
  return String(observed);
}

/** Redacted evidence: the shape of the observation, no secret value. */
function evidenceOf(id: string, observed: unknown): string {
  if (id === "host.skills-installed") {
    const o = (observed ?? {}) as SkillsInstalledObservation;
    const roster = COMMAND_ROSTER_UNVERIFIED;
    if (o.shadowed !== undefined && o.shadowed.length > 0) {
      return `${roster}; shadowed copy of ${o.shadowed[0].name} at version ${o.shadowed[0].version}`;
    }
    return roster;
  }
  if (id === "host.permission-mode") {
    const o = (observed ?? {}) as PermissionModeObservation | null;
    return o === null ? "not observed" : `mode=${o.mode} approval=${o.approval}`;
  }
  if (id === "host.kanban-plugin") {
    const o = observed as KanbanPluginObservation | null | undefined;
    if (o === undefined || o === null || !o.installed) return "not installed";
    // No secret value: the pin shape and the start state only.
    return `spec=${o.exact ? "exact" : "range"} serverHalf=${o.serverHalf}`;
  }
  return observed === undefined || observed === null
    ? "not observed"
    : JSON.stringify(observed);
}

/** `<severity> <check> — <fix>` — the kit doctor body's grammar. */
export function formatFinding(finding: DoctorFinding): string {
  return `${finding.severity} ${finding.id} — ${finding.fix}`;
}

/** The kit's `DOCTOR_EXITS` array itself — read at load, never restated. */
export function dshDoctorExits(): typeof DOCTOR_EXITS {
  return DOCTOR_EXITS;
}

/**
 * The full doctor run: findings, printed lines (`--json` in the EP-14 shape
 * instead, when asked) and the exit code. An unknown id in a filter exits
 * with the kit's usage-error exit; findings approve nothing.
 */
export async function runDoctor(
  observations: DshObservations,
  options: {
    engineVersion: string;
    json?: boolean;
    filter?: readonly string[];
    host?: string;
    audience?: Audience;
    now?: () => string;
  },
): Promise<DoctorRunResult> {
  const checks = dshDoctorChecks(options.engineVersion);
  if (options.filter !== undefined) {
    const known = new Set(checks.map((check) => check.id));
    const unknown = options.filter.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      const exit = UNKNOWN_CHECK_ID_IN_A_FILTER_EXIT_CODE;
      const selected = checks.filter((check) =>
        options.filter!.includes(check.id),
      );
      const partial = await runDoctorFindings(selected, observations);
      return {
        ...partial,
        exit,
        output: partial.findings.map(formatFinding).join("\n"),
        json: options.json === true ? doctorJson(partial.findings, exit, options) : undefined,
      };
    }
  }
  const selected =
    options.filter === undefined
      ? checks
      : checks.filter((check) => options.filter!.includes(check.id));
  const { findings, exit } = await runDoctorFindings(selected, observations);
  return {
    findings,
    exit,
    thrown: false,
    output: findings.map(formatFinding).join("\n"),
    json: options.json === true ? doctorJson(findings, exit, options) : undefined,
  };
}

/** The EP-14 finding shape (`specstride.doctor/1`, F120-FR-014). */
function doctorJson(
  findings: readonly DoctorFinding[],
  exit: number,
  options: { host?: string; audience?: Audience; now?: () => string },
): string {
  const record = {
    schema: SCHEMA_ID || FINDINGS_SCHEMA_ID,
    at: (options.now ?? (() => new Date().toISOString()))(),
    host: options.host ?? "dsh",
    audience: options.audience ?? "personal",
    exit,
    summary: summaryOf(findings as readonly Finding[]),
    findings,
  };
  return JSON.stringify(record, null, 2);
}

/* -------------------------------------------------------------------------
 * The real probes — what the runner reads off this machine
 * ---------------------------------------------------------------------- */

export type CollectIo = {
  /** The exec step; injected in tests so a probe can be observed, not run. */
  readonly execFile?: (
    file: string,
    args: readonly string[],
  ) => Promise<string>;
};

function defaultExec(file: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    nodeExecFile(file, args, (error, stdout) =>
      error === null ? resolve(stdout) : reject(error),
    );
  });
}

async function tryExec(
  exec: (file: string, args: readonly string[]) => Promise<string>,
  file: string,
  args: readonly string[],
): Promise<string | null> {
  try {
    return await exec(file, args);
  } catch {
    return null;
  }
}

/**
 * Observe the machine for the runner — every probe reads and never writes,
 * except the state-home probe file, which is created and then removed. With
 * no CLI reachable via `SPECSTRIDE_BIN` or PATH nothing is executed at all:
 * the protocol is simply unprobeable.
 */
export async function collectObservations(
  env: NodeJS.ProcessEnv,
  io: CollectIo = {},
): Promise<DshObservations> {
  const exec = io.execFile ?? defaultExec;
  const shimDirectory = join(ROOT, "bin");
  const resolution = resolveExecutable({
    env: env as Readonly<Record<string, string | undefined>>,
    shimDirectory,
    isExecutable: (path) => {
      if (!existsSync(path) || !statIsFile(path)) return false;
      try {
        accessSync(path, fsConstants.X_OK);
        return true;
      } catch {
        return false;
      }
    },
    publishedBin: (packageRoot) => {
      try {
        const manifest = JSON.parse(
          readFileSync(join(packageRoot, "package.json"), "utf8"),
        ) as { bin?: Record<string, string> };
        const bin = manifest.bin?.["specstride"];
        if (bin === undefined) return null;
        const path = join(packageRoot, bin);
        return existsSync(path) ? path : null;
      } catch {
        return null;
      }
    },
  });

  const observations: {
    "cli-found"?: CliObservation;
    protocol?: number | null;
    "dsh-version"?: string | null;
    "skills-installed"?: SkillsInstalledObservation;
    "state-root-writable"?: "writable" | "blocked" | "unverified";
    "permission-mode"?: PermissionModeObservation;
  } = {};

  if (resolution.path !== null) {
    const stdout = await tryExec(exec, resolution.path, ["--protocol"]);
    observations.protocol = stdout === null ? null : readProtocol(stdout);
    observations["cli-found"] = { path: resolution.path, answersProtocol: observations.protocol !== null };
  } else {
    observations["cli-found"] = false;
    observations.protocol = null; // unprobeable
  }

  const dshVersion = await tryExec(exec, "dsh", ["--version"]);
  observations["dsh-version"] =
    dshVersion === null ? null : dshVersion.trim().split(/\s+/)[0] ?? null;

  observations["skills-installed"] = skillsInstalledObservation(env);

  observations["kanban-plugin"] = kanbanPluginObservation(env);

  observations["state-root-writable"] = stateRootWritable(env);

  const mode =
    env.DSH_PERMISSION_MODE !== undefined && env.DSH_PERMISSION_MODE !== ""
      ? env.DSH_PERMISSION_MODE
      : "workspace-write"; // the rc.8 default (host-facts, verified)
  const approval =
    env.DSH_PROFILE === "headless" ? "no-approver" : "answerable";
  observations["permission-mode"] = { mode, approval };

  return observations;
}

function statIsFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * The three skill directories in the roots this package knows (HF-01), in
 * dsh's rank order: `<projectRoot>/.dsh/skills` (100), `<projectRoot>/.agents/skills`
 * (200), `$DSH_HOME/skills` (400), `~/.agents/skills` (500). The project root is
 * the installer's: `PROJECT_ROOT`, else the working directory.
 *
 * Per skill, the copy dsh loads is the one in the highest-rank root that has it.
 * Missing: no root has it. Stale: the loaded copy is at another version than this
 * package. Shadowed: a higher-rank copy at another version hides a copy at this
 * package's version in a lower-rank root. An install in any of the three install
 * scopes (project, user, shared) therefore satisfies the check.
 */
export function skillsInstalledObservation(
  env: NodeJS.ProcessEnv,
  cwd: string = process.cwd(),
): SkillsInstalledObservation {
  const packageVersion = (
    JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      version?: string;
    }
  ).version ?? "0.0.0";
  const nonEmpty = (value: string | undefined): string | null =>
    value !== undefined && value !== "" ? value : null;
  const projectRoot = nonEmpty(env.PROJECT_ROOT) ?? cwd;
  const dshHome = dshHomeOf(env);
  const home = nonEmpty(env.HOME);
  const roots: string[] = [
    join(projectRoot, ".dsh", "skills"),
    join(projectRoot, ".agents", "skills"),
    ...(dshHome !== null ? [join(dshHome, "skills")] : []),
    ...(home !== null ? [join(home, ".agents", "skills")] : []),
  ];
  const missing: string[] = [];
  const stale: string[] = [];
  const shadowed: { name: string; root: string; version: string }[] = [];
  for (const name of SKILL_SPELLINGS) {
    const copies = roots
      .filter((root) => existsSync(join(root, name, "SKILL.md")))
      .map((root) => ({ root, version: skillVersion(join(root, name, "SKILL.md")) }));
    if (copies.length === 0) {
      missing.push(name);
      continue;
    }
    const loaded = copies[0];
    if (loaded.version === packageVersion) continue;
    if (copies.slice(1).some((copy) => copy.version === packageVersion)) {
      shadowed.push({ name, root: loaded.root, version: loaded.version ?? "unknown" });
    } else {
      stale.push(name);
    }
  }
  return { missing, stale, shadowed, shimOnPath: onPath(SHIM_BIN, env) };
}

/** Whether `name` is an executable file in a directory of `env.PATH`. */
function onPath(name: string, env: NodeJS.ProcessEnv): boolean {
  for (const dir of (env.PATH ?? "").split(":")) {
    if (dir === "") continue;
    const path = join(dir, name);
    try {
      if (!statSync(path).isFile()) continue;
      accessSync(path, fsConstants.X_OK);
      return true;
    } catch {
      // not here
    }
  }
  return false;
}

/** The `metadata.version` of a rendered SKILL.md, or null. */
function skillVersion(path: string): string | null {
  try {
    const text = readFileSync(path, "utf8");
    const m = /^metadata:\s*\n\s*version:\s*(\S+)/m.exec(text);
    return m === null ? null : m[1];
  } catch {
    return null;
  }
}

/**
 * The kanban plugin in the web profile (F121-FR-019, R11): the spec under
 * `$DSH_HOME/profiles/web/package.json` (dependencies or devDependencies),
 * exact only when the raw spec is a bare version. The server half's start
 * line is `unknown` here: dsh rc.8 exposes no per-profile log surface to
 * read (unverified, HF row) — "started" is never assumed, only reported
 * from the server half's own line when a log surface exists.
 */
/**
 * dsh's home: `DSH_HOME` when set, else dsh's own default `~/.dsh` (dsh
 * 0.1.0-rc.8: `dsh web` with no `DSH_HOME` loads `~/.dsh/profiles/web`).
 */
export function dshHomeOf(env: NodeJS.ProcessEnv): string | null {
  if (env.DSH_HOME !== undefined && env.DSH_HOME !== "") return env.DSH_HOME;
  if (env.HOME !== undefined && env.HOME !== "") return join(env.HOME, ".dsh");
  return null;
}

export function kanbanPluginObservation(
  env: NodeJS.ProcessEnv,
): KanbanPluginObservation {
  const home = dshHomeOf(env);
  const manifestPath = home !== null
    ? join(home, "profiles", "web", "package.json")
    : null;
  if (manifestPath === null) {
    return { installed: false, exact: false, serverHalf: "unknown" };
  }
  let manifest: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return { installed: false, exact: false, serverHalf: "unknown" };
  }
  const spec =
    manifest.dependencies?.[KANBAN_PLUGIN_NAME] ??
    manifest.devDependencies?.[KANBAN_PLUGIN_NAME];
  if (typeof spec !== "string") {
    return { installed: false, exact: false, serverHalf: "unknown" };
  }
  return {
    installed: true,
    spec,
    // An exact version, or a `file:` tarball (one fixed artifact, not a range).
    exact: /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/.test(spec.trim()) || /^file:.+\.tgz$/.test(spec.trim()),
    serverHalf: "unknown",
  };
}

/** Probe file under `$XDG_STATE_HOME/specstride/`, then removed. */
function stateRootWritable(env: NodeJS.ProcessEnv): "writable" | "blocked" {
  const base =
    env.XDG_STATE_HOME !== undefined && env.XDG_STATE_HOME !== ""
      ? env.XDG_STATE_HOME
      : join(env.HOME ?? "", ".local", "state");
  const dir = join(base, "specstride");
  const probe = join(dir, "doctor-probe");
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(probe, "probe", "utf8");
    unlinkSync(probe);
    return "writable";
  } catch {
    return "blocked";
  }
}

/* -------------------------------------------------------------------------
 * The command entry point the control CLI wires (T021)
 * ---------------------------------------------------------------------- */

/**
 * `specstride-host-dsh doctor [--json] [id…]` — collect the observations,
 * run the checks, print one line per finding (or the `--json` record), and
 * return the exit code of the kit's table.
 */
export async function doctorMain(argv: readonly string[]): Promise<number> {
  const json = argv.includes("--json");
  const rest = argv.filter((arg) => !arg.startsWith("--"));
  const filter = rest.length > 0 ? rest : undefined;
  const engineVersion = (
    JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      specstride?: { engineVersion?: string };
    }
  ).specstride!.engineVersion!;
  const observations = await collectObservations(process.env);
  const { output, exit, json: record } = await runDoctor(observations, {
    engineVersion,
    json,
    filter,
  });
  if (record !== undefined) console.log(record);
  else if (output.length > 0) console.log(output);
  return exit;
}
