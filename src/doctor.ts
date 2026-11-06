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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLOSED_SETS = JSON.parse(
  readFileSync(
    join(ROOT, "specs", "120-host-dsh", "contracts", "closed-sets.json"),
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
};

export type PermissionModeObservation = {
  /** `DSH_PERMISSION_MODE` in force (default `workspace-write`, rc.8). */
  readonly mode: string;
  /** Whether an approval can be answered in this session. */
  readonly approval: "answerable" | "no-approver";
};

export type DshObservations = {
  readonly "cli-found"?: boolean;
  readonly protocol?: number | null;
  readonly "dsh-version"?: string | null;
  readonly "skills-installed"?: SkillsInstalledObservation;
  readonly "state-root-writable"?: "writable" | "blocked" | "unverified";
  readonly "permission-mode"?: PermissionModeObservation;
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
      severityRule: (observed) =>
        unobserved(observed, () => (observed === true ? "ok" : "fail")),
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
        if (o.missing.length > 0) return "fail";
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
      fix: check.fixHint,
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

function describeObservation(id: string, observed: unknown): string {
  if (id === "host.skills-installed") {
    const o = observed as SkillsInstalledObservation;
    const parts: string[] = [];
    if (o.missing.length > 0) parts.push(`missing: ${o.missing.join(", ")}`);
    if (o.stale.length > 0) parts.push(`stale: ${o.stale.join(", ")}`);
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
    "cli-found"?: boolean;
    protocol?: number | null;
    "dsh-version"?: string | null;
    "skills-installed"?: SkillsInstalledObservation;
    "state-root-writable"?: "writable" | "blocked" | "unverified";
    "permission-mode"?: PermissionModeObservation;
  } = {};

  observations["cli-found"] = resolution.path !== null;
  if (resolution.path !== null) {
    const stdout = await tryExec(exec, resolution.path, ["--protocol"]);
    observations.protocol = stdout === null ? null : readProtocol(stdout);
  } else {
    observations.protocol = null; // unprobeable
  }

  const dshVersion = await tryExec(exec, "dsh", ["--version"]);
  observations["dsh-version"] =
    dshVersion === null ? null : dshVersion.trim().split(/\s+/)[0] ?? null;

  observations["skills-installed"] = skillsInstalledObservation(env);

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

/** The three skill directories in the roots this package knows (HF-01). */
function skillsInstalledObservation(
  env: NodeJS.ProcessEnv,
): SkillsInstalledObservation {
  const packageVersion = (
    JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      version?: string;
    }
  ).version ?? "0.0.0";
  const userRoot =
    env.DSH_HOME !== undefined && env.DSH_HOME !== ""
      ? join(env.DSH_HOME, "skills")
      : null;
  const projectRoot = env.PROJECT_ROOT ?? null;
  // Higher-rank roots shadow a lower-rank copy (rank 100 and 200 of HF-01).
  const higherRankRoots = projectRoot
    ? [join(projectRoot, ".dsh", "skills"), join(projectRoot, ".agents", "skills")]
    : [];
  const missing: string[] = [];
  const stale: string[] = [];
  const shadowed: { name: string; root: string; version: string }[] = [];
  for (const name of SKILL_SPELLINGS) {
    if (userRoot !== null && !existsSync(join(userRoot, name, "SKILL.md"))) {
      missing.push(name);
      continue;
    }
    if (userRoot !== null) {
      const version = skillVersion(join(userRoot, name, "SKILL.md"));
      if (version !== null && version !== packageVersion) stale.push(name);
    }
    for (const root of higherRankRoots) {
      const version = skillVersion(join(root, name, "SKILL.md"));
      if (version !== null) {
        shadowed.push({ name, root, version });
        break;
      }
    }
  }
  return { missing, stale, shadowed };
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
