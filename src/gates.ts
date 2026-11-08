/**
 * The cross-cutting build gates as reusable helpers (T034, T035; F120-SC-002,
 * F120-SC-004, F120-SC-005; F120-FR-003, F120-FR-004, F120-FR-009,
 * F120-FR-025, F120-FR-026; research.md R5, R6, R11).
 *
 * Everything here is a MEASUREMENT over text or bytes — no model call, no
 * paid or external API, no dsh session (F120-FR-025). `scripts/build.ts`
 * calls these and fails naming the offending artifact; the contract tests
 * read the same helpers so the gate and its test cannot drift.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

export function sha256Of(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/* ---------------------------------------------------------------------------
 * Line attribution (F120-SC-002, R5): every rendered body line must
 * originate in the kit's body text or in one of the three whitelisted
 * generated blocks — the frontmatter insertion, the dsh runtime section, the
 * doctor appendix. Anything else is attributed to nobody and fails the build.
 * ------------------------------------------------------------------------ */

export const WHITELISTED_GENERATED_BLOCKS = Object.freeze([
  "frontmatter insertion",
  "dsh runtime section",
  "doctor appendix",
] as const);

/** The composed lines no origin claims, blank lines excepted. */
export function unattributedLines(
  composed: string,
  origins: readonly string[],
): readonly string[] {
  const originLines = new Set<string>();
  for (const text of origins) {
    for (const line of text.split("\n")) originLines.add(line);
  }
  const unattributed: string[] = [];
  for (const line of composed.split("\n")) {
    if (line.trim() === "") continue;
    if (!originLines.has(line)) unattributed.push(line);
  }
  return unattributed;
}

/* ---------------------------------------------------------------------------
 * Reference closure (F120-FR-009, part of the conformance bar): no path from
 * a skill into product source, state or logs.
 * ------------------------------------------------------------------------ */

/** One forbidden reference class, with the reason the finding names. */
export const REFERENCE_CLOSURE_PATTERNS: readonly {
  readonly pattern: RegExp;
  readonly reason: string;
}[] = Object.freeze([
  { pattern: /\/root\//, reason: "an absolute path into a machine's home tree" },
  { pattern: /\/home\//, reason: "an absolute path into a machine's home tree" },
  { pattern: /specstride-core/, reason: "a path into the engine checkout" },
  { pattern: /vendor\/core/, reason: "a path into this repository's vendor tree" },
  { pattern: /node_modules/, reason: "a path into an install tree" },
  { pattern: /XDG_STATE_HOME/, reason: "a path into the product's state home" },
  { pattern: /\.local\/state/, reason: "a path into the product's state home" },
  { pattern: /\.jsonl/, reason: "a path into the product's logs" },
  { pattern: /\bsrc\/\w+\.(ts|mjs)\b/, reason: "a path into source files" },
  { pattern: /packages\/(contracts|host-kit|testkit|runtime|specstride)/, reason: "a path into an engine package tree" },
]);

/** The closure findings of one rendered skill text (empty = closed). */
export function referenceClosureFindings(
  text: string,
  artifact: string,
): readonly string[] {
  const findings: string[] = [];
  for (const { pattern, reason } of REFERENCE_CLOSURE_PATTERNS) {
    const match = pattern.exec(text);
    if (match !== null) {
      findings.push(
        `${artifact}: reference into ${reason} — "${match[0]}" (F120-FR-009)`,
      );
    }
  }
  return findings;
}

/**
 * The closure findings over a COMPOSED rendered skill, with the lines of a
 * generated appendix excluded — used for the doctor, whose generated
 * host-checks appendix quotes the probe targets of the checks verbatim
 * from `specs/120-host-dsh/contracts/doctor-host-checks.md`. Those probes run
 * inside the doctor runner, never as paths a skill session follows; line
 * attribution already pins every appendix line to that generated block.
 * Recorded here, not a silent exception.
 */
export function referenceClosureFindingsForComposed(
  composed: string,
  artifact: string,
  appendixLines: readonly string[] = [],
): readonly string[] {
  if (appendixLines.length === 0) return referenceClosureFindings(composed, artifact);
  const appendix = new Set(appendixLines);
  const rest = composed
    .split("\n")
    .filter((line) => !appendix.has(line))
    .join("\n");
  return referenceClosureFindings(rest, artifact);
}

/* ---------------------------------------------------------------------------
 * Description measures (F120-FR-003, F120-FR-026): the two model-invocable
 * descriptions together ≤ 1,000 characters and each ≤ 500 — MEASURED, never
 * assumed.
 * ------------------------------------------------------------------------ */

export const DESCRIPTION_COMBINED_CAP = 1_000;
export const DESCRIPTION_SINGLE_CAP = 500;

export function descriptionMeasureViolations(
  descriptions: Readonly<Record<string, string>>,
): readonly string[] {
  const violations: string[] = [];
  let combined = 0;
  for (const [id, description] of Object.entries(descriptions)) {
    const length = [...description].length;
    combined += length;
    if (length > DESCRIPTION_SINGLE_CAP) {
      violations.push(
        `description of ${id} is ${length} characters over the cap of ${DESCRIPTION_SINGLE_CAP} (F120-FR-003)`,
      );
    }
  }
  if (combined > DESCRIPTION_COMBINED_CAP) {
    violations.push(
      `the model-invocable descriptions together measure ${combined} characters over the cap of ${DESCRIPTION_COMBINED_CAP} (F120-FR-026)`,
    );
  }
  return violations;
}

/* ---------------------------------------------------------------------------
 * Zero engine copies (F120-SC-005, R11): every shipped file hashed and
 * compared against every file of the four pinned tarballs, and — dev gate —
 * against every file of the core checkout at the pinned version. Any match
 * fails naming the pair.
 * ------------------------------------------------------------------------ */

export type FileHashes = Readonly<Record<string, string>>;

/** sha256 of every file under a directory (relative, `/`-separated paths). */
export function hashTree(root: string, skip: readonly string[] = []): FileHashes {
  const hashes: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (skip.includes(entry)) continue;
      const path = join(dir, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) {
        hashes[join(dir, entry).slice(root.length + 1).split("\\").join("/")] =
          sha256Of(readFileSync(path));
      }
    }
  };
  walk(root);
  return hashes;
}

/** sha256 of every file inside one packed tarball, extracted to a temp dir. */
export function hashTarball(tarball: string): FileHashes {
  const base = mkdtempSync(join(tmpdir(), "specstride-dsh-copies-"));
  try {
    const out = spawnSync("tar", ["-xzf", tarball, "-C", base], { encoding: "utf8" });
    if (out.status !== 0) {
      throw new Error(`cannot read the pinned tarball ${basename(tarball)}: ${out.stderr}`);
    }
    const all = hashTree(base);
    // Strip the tarball's `package/` prefix so the keys are package-relative.
    const stripped: Record<string, string> = {};
    for (const [path, hash] of Object.entries(all)) {
      stripped[path.replace(/^package\//, "")] = hash;
    }
    return stripped;
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

/** The (shipped, engine) pairs whose bytes are identical — expected: none. */
export function copyMatches(
  shipped: FileHashes,
  engine: FileHashes,
): readonly { readonly shipped: string; readonly engine: string }[] {
  const matches: { shipped: string; engine: string }[] = [];
  for (const [enginePath, engineHash] of Object.entries(engine)) {
    for (const [shippedPath, shippedHash] of Object.entries(shipped)) {
      if (shippedHash === engineHash) {
        matches.push({ shipped: shippedPath, engine: enginePath });
      }
    }
  }
  return matches;
}

/* ---------------------------------------------------------------------------
 * Manifest checks (R6): the protocol range {min:1,max:1} is declared ONCE —
 * in the manifest — and nowhere in src/ or scripts/.
 * ------------------------------------------------------------------------ */

export const PROTOCOL_RANGE_DECLARATION =
  /SUPPORTED_PROTOCOL_(MIN|MAX)|["']?protocol["']?\s*:\s*\{[^}]*min/;

export function protocolRangeRestatements(
  files: readonly { readonly path: string; readonly text: string }[],
): readonly string[] {
  return files
    .filter((file) => PROTOCOL_RANGE_DECLARATION.test(file.text))
    .map((file) => file.path);
}

/* ---------------------------------------------------------------------------
 * The kanban no-model scan (T050, F121-SC-005): the plugin's sources,
 * scripts and tests hold no provider SDK import, no provider host name and
 * no API-key variable read. A measurement over text — never a network call.
 * ------------------------------------------------------------------------ */

/** One finding of the kanban no-model scan: file, line, what matched. */
export type KanbanNoModelFinding = {
  readonly path: string;
  readonly line: number;
  readonly detail: string;
};

/** The provider SDK packages, provider host names and API-key reads. */
const KANBAN_NO_MODEL_PATTERNS: readonly {
  readonly what: string;
  readonly pattern: RegExp;
}[] = Object.freeze([
  { what: "provider SDK import", pattern: /@anthropic-ai\/|@openai\/|from\s+["']openai["']|\brequire\(\s*["']openai["']|@google\/generative-ai|["']cohere-ai["']|["']@mistralai\// },
  { what: "provider host name", pattern: /api\.anthropic\.com|api\.openai\.com|api\.deepseek\.com|generativelanguage\.googleapis\.com|api\.mistral\.ai|api\.cohere\.com/ },
  { what: "API key variable read", pattern: /\bprocess\.env\.[A-Z_]*(API_KEY|APIKEY|ANTHROPIC|OPENAI|DEEPSEEK|GEMINI|COHERE|MISTRAL)/ },
]);

/** Scan a directory tree of text files for the no-model patterns (T050). */
export function kanbanNoModelFindings(
  root: string,
  trees: readonly string[] = ["src", "scripts", "tests"],
): readonly KanbanNoModelFinding[] {
  const findings: KanbanNoModelFinding[] = [];
  const scanFile = (path: string): void => {
    const text = readFileSync(path, "utf8");
    for (const [index, line] of text.split("\n").entries()) {
      for (const { what, pattern } of KANBAN_NO_MODEL_PATTERNS) {
        if (pattern.test(line)) {
          findings.push({ path, line: index + 1, detail: `${what}: ${line.trim().slice(0, 120)}` });
        }
      }
    }
  };
  const walk = (directory: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(directory);
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        if (entry === "node_modules" || entry === "lib" || entry === "generated") continue;
        walk(path);
      } else {
        scanFile(path);
      }
    }
  };
  for (const tree of trees) walk(join(root, tree));
  return findings;
}
