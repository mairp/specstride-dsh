/**
 * T007 — the kanban build stage (research.md R6), called by `scripts/build.ts`
 * after 120's stages. No bundler: each `.ts` of `src/` goes through
 * `stripTypeScriptTypes(source, { mode: "strip" })`.
 *
 *  - `src/server/*` and `src/shared/*` → `lib/server/*.js`, `lib/shared/*.js` as ESM,
 *    relative `.ts` specifiers rewritten to `.js`;
 *  - `src/client/*` and `src/shared/*` → ONE `lib/client.js`: a single
 *    `window.__ModuleLoader__.load({ id, factory })` holding a module table; its only
 *    external `require` calls are `react` and `@deepseek-ai/dsh-client-runtime/client`;
 *    `src/client/styles.css` is inlined as a string.
 * Any failure throws an Error naming the file.
 */
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, writeFileSync, existsSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { checkContractValues, writeContractValues, presentationValues } from "./gen-contract-values.ts";
import { formatFinding, scanTree } from "./scan.ts";
import { DETAIL_SETS } from "../src/shared/presentation.ts";

export const PLUGIN_ID = "@specstride/dsh-kanban";
export const EXTERNALS = ["react", "@deepseek-ai/dsh-client-runtime/client"] as const;
/** The scoped class prefix of the stylesheet (the neutral placeholder; T035, F121-FR-012). */
export const STYLE_PREFIX = "ssk-00000000";

/**
 * One rule per distinct grayscale value of the three presentation sets
 * (contracts/presentation.md "Styles"; F121-FR-013): generated from
 * `contracts/kanban-closed-sets.json`, so no two members of one set share a
 * grayscale step. Appended to every inlined stylesheet of the bundle.
 */
export function grayRules(): string {
  const values = presentationValues();
  const grays = new Set<number>();
  for (const key of ["LANE_PRESENTATION", "ATTENTION_PRESENTATION", "BUDGET_PRESENTATION"]) {
    for (const member of Object.values(values[key] as Record<string, { grayscale: number }>)) grays.add(member.grayscale);
  }
  for (const key of ["LANE_PRESENTATION_UNKNOWN", "ATTENTION_PRESENTATION_UNKNOWN", "BUDGET_PRESENTATION_UNKNOWN"]) {
    grays.add((values[key] as { grayscale: number }).grayscale);
  }
  // The plugin-local sets of the card detail panel (F121-FR-022).
  for (const set of Object.values(DETAIL_SETS)) {
    for (const member of Object.values(set.members)) grays.add(member.grayscale);
    grays.add(set.unknown.grayscale);
  }
  return [...grays]
    .sort((a, b) => a - b)
    .map((value) => `.${STYLE_PREFIX} [data-gray="${value}"] { opacity: ${(value / 255).toFixed(3)}; }`)
    .join("\n");
}

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export type BuildOptions = {
  /** The package root holding `src/`; default the real package. */
  root?: string;
  /** Regenerate and check `src/shared/generated/contract-values.ts` (T005); default true. */
  generate?: boolean;
};

function fail(file: string, message: string): never {
  throw new Error(`${file}: ${message}`);
}

function sourcesUnder(directory: string, extension: string): string[] {
  if (!existsSync(directory)) return [];
  return (readdirSync(directory, { recursive: true }) as string[])
    .map(String)
    .filter((name) => name.endsWith(extension) && !name.endsWith(".d.ts"))
    .map((name) => name.split("\\").join("/"))
    .sort();
}

function strip(file: string, source: string): string {
  try {
    return stripTypeScriptTypes(source, { mode: "strip" });
  } catch (error) {
    return fail(file, `TypeScript cannot be erased: ${(error as Error).message.split("\n")[0]}`);
  }
}

/* ---------------------------------- server half --------------------------------- */

function toEsmJs(file: string, code: string): string {
  // Relative specifiers `x.ts` → `x.js`; a bare specifier stays (Node built-ins only).
  return code.replace(/(\bfrom\s*|\bimport\s*\(?\s*)(["'])(\.{1,2}\/[^"']*)\.ts\2/g, (_m, lead: string, quote: string, path: string) => `${lead}${quote}${path}.js${quote}`);
}

/* ---------------------------------- client half --------------------------------- */

type ModuleSpec = { id: string; code: string };

function resolveInternal(file: string, from: string, specifier: string, known: ReadonlySet<string>): string {
  const base = posix.normalize(posix.join(posix.dirname(from), specifier));
  const id = base.endsWith(".css") ? base : base.replace(/\.(ts|js)$/, "");
  if (!known.has(id)) fail(file, `import "${specifier}" resolves to ${id}, which is not a module of the client bundle (src/client, src/shared)`);
  return id;
}

/** ESM → a module-table function body. Only the import/export forms the sources use are handled. */
function toTableModule(file: string, id: string, code: string, known: ReadonlySet<string>): string {
  let counter = 0;
  const tail: string[] = [];
  const requireOf = (specifier: string): string => {
    if (specifier.startsWith(".")) return `__load(${JSON.stringify(resolveInternal(file, id, specifier, known))})`;
    if (!(EXTERNALS as readonly string[]).includes(specifier)) {
      return fail(file, `import "${specifier}": the client bundle may require only ${EXTERNALS.join(" and ")}`);
    }
    return `require(${JSON.stringify(specifier)})`;
  };
  const bind = (clause: string, specifier: string): string => {
    const name = `__m${(counter += 1)}`;
    const lines = [`const ${name} = ${requireOf(specifier)};`];
    let rest = clause.trim();
    const namespace = /^(?:([\w$]+)\s*,\s*)?\*\s+as\s+([\w$]+)$/.exec(rest);
    if (namespace !== null) {
      if (namespace[1] !== undefined) lines.push(`const ${namespace[1]} = __default(${name});`);
      lines.push(`const ${namespace[2]} = ${name};`);
      return lines.join(" ");
    }
    const named = /\{([\s\S]*)\}/.exec(rest);
    if (named !== null) {
      rest = rest.replace(named[0], "").replace(/,\s*$/, "").trim();
      const members = (named[1] as string)
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part !== "")
        .map((part) => part.replace(/\s+as\s+/, ": "));
      if (members.length > 0) lines.push(`const { ${members.join(", ")} } = ${name};`);
    }
    if (rest !== "") lines.push(`const ${rest} = __default(${name});`);
    return lines.join(" ");
  };

  let out = code;
  out = out.replace(/^import\s+([\s\S]*?)\s*from\s*(["'])([^"']+)\2\s*;?/gm, (_m, clause: string, _q: string, spec: string) => bind(clause, spec));
  out = out.replace(/^import\s*(["'])([^"']+)\1\s*;?/gm, (_m, _q: string, spec: string) => `${requireOf(spec)};`);
  out = out.replace(/^export\s*\*\s*from\s*(["'])([^"']+)\1\s*;?/gm, (_m, _q: string, spec: string) => {
    const name = `__m${(counter += 1)}`;
    return `const ${name} = ${requireOf(spec)}; for (const k of Object.keys(${name})) if (k !== "default") exports[k] = ${name}[k];`;
  });
  out = out.replace(/^export\s*\{([\s\S]*?)\}\s*from\s*(["'])([^"']+)\2\s*;?/gm, (_m, list: string, _q: string, spec: string) => {
    const name = `__m${(counter += 1)}`;
    const parts = list.split(",").map((p) => p.trim()).filter(Boolean).map((p) => {
      const [from, to] = p.split(/\s+as\s+/);
      return `exports.${to ?? from} = ${name}.${from};`;
    });
    return `const ${name} = ${requireOf(spec)}; ${parts.join(" ")}`;
  });
  out = out.replace(/^export\s*\{([\s\S]*?)\}\s*;?/gm, (_m, list: string) => {
    for (const part of list.split(",").map((p) => p.trim()).filter(Boolean)) {
      const [from, to] = part.split(/\s+as\s+/);
      tail.push(`exports.${to ?? from} = ${from};`);
    }
    return "";
  });
  out = out.replace(/^export\s+default\s+(async\s+)?(function|class)\s+([\w$]+)/gm, (_m, a: string | undefined, kind: string, name: string) => {
    tail.push(`exports.default = ${name};`);
    return `${a ?? ""}${kind} ${name}`;
  });
  out = out.replace(/^export\s+default\s+/gm, "exports.default = ");
  out = out.replace(/^export\s+(?:async\s+)?(?:function\*?|class)\s+([\w$]+)/gm, (m, name: string) => {
    tail.push(`exports.${name} = ${name};`);
    return m.replace(/^export\s+/, "");
  });
  out = out.replace(/^export\s+(const|let|var)\s+([\w$]+)/gm, (_m, kind: string, name: string) => {
    tail.push(`exports.${name} = ${name};`);
    return `${kind} ${name}`;
  });
  const left = /^(import|export)\b.*/m.exec(out);
  if (left !== null) fail(file, `unsupported module syntax in the client bundle: ${left[0].slice(0, 60)}`);
  if (/\bimport\s*\(|\bimport\.meta\b/.test(out)) fail(file, "dynamic import and import.meta are not allowed in the client bundle");
  return `${out}\n${tail.join("\n")}`;
}

function clientBundle(root: string): { text: string; modules: number } {
  const src = join(root, "src");
  const cssFiles = sourcesUnder(join(src, "client"), ".css").map((name) => `client/${name}`);
  const tsIds = [
    ...sourcesUnder(join(src, "client"), ".ts").map((name) => `client/${name}`),
    ...sourcesUnder(join(src, "shared"), ".ts").map((name) => `shared/${name}`),
  ];
  const known = new Set([...tsIds.map((path) => path.replace(/\.ts$/, "")), ...cssFiles]);
  const table: ModuleSpec[] = [];
  for (const path of tsIds) {
    const id = path.replace(/\.ts$/, "");
    const code = strip(path, readFileSync(join(src, path), "utf8"));
    table.push({ id, code: toTableModule(path, id, code, known) });
  }
  for (const path of cssFiles) {
    table.push({ id: path, code: `module.exports = ${JSON.stringify(readFileSync(join(src, path), "utf8"))};` });
  }
  table.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const entry = known.has("client/index") ? "client/index" : null;
  const body = table
    .map((module) => `    ${JSON.stringify(module.id)}: function (module, exports) {\n${module.code.split("\n").map((l) => `      ${l}`).join("\n")}\n    },`)
    .join("\n");
  const text = [
    "window.__ModuleLoader__.load({",
    `  id: ${JSON.stringify(PLUGIN_ID)},`,
    "  factory: (require) => {",
    "    const __table = {",
    body,
    "    };",
    "    const __cache = {};",
    "    const __default = (m) => (m && m.__esModule ? m.default : m);",
    "    const __load = (id) => {",
    "      if (__cache[id] === undefined) {",
    "        const module = { exports: {} };",
    "        __cache[id] = module;",
    "        Object.defineProperty(module.exports, \"__esModule\", { value: true });",
    "        __table[id](module, module.exports);",
    "      }",
    "      return __cache[id].exports;",
    "    };",
    `    return ${entry === null ? "{}" : `__load(${JSON.stringify(entry)})`};`,
    "  },",
    "});",
    "",
  ].join("\n");
  // The externals are exactly the allowed two (the table refused anything else above).
  for (const match of text.matchAll(/\brequire\(("[^"]*")\)/g)) {
    if (!(EXTERNALS as readonly string[]).includes(JSON.parse(match[1] as string))) fail("lib/client.js", `external require ${match[1]}`);
  }
  return { text, modules: table.length };
}

/* ------------------------------------- stage ------------------------------------ */

/** Write each file atomically and only when it differs; remove stale files and empty directories. */
function writeOutputs(lib: string, outputs: ReadonlyMap<string, string>): void {
  for (const [path, text] of outputs) {
    const target = join(lib, path);
    if (existsSync(target) && readFileSync(target, "utf8") === text) continue;
    mkdirSync(dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, text, "utf8");
    renameSync(temporary, target);
  }
  if (!existsSync(lib)) return;
  const present = (readdirSync(lib, { recursive: true, withFileTypes: true }) as import("node:fs").Dirent[]).sort(
    (a, b) => `${b.parentPath}/${b.name}`.length - `${a.parentPath}/${a.name}`.length,
  );
  for (const entry of present) {
    const full = join(entry.parentPath, entry.name);
    const relative = full.slice(lib.length + 1).split("\\").join("/");
    try {
      if (entry.isDirectory()) {
        if (![...outputs.keys()].some((path) => path.startsWith(`${relative}/`))) rmdirSync(full);
      }
      else if (!outputs.has(relative) && !relative.endsWith(".tmp")) rmSync(full, { force: true });
    } catch {
      // a directory still in use, or a file removed by a concurrent build: both are fine
    }
  }
}

export function buildKanban(options: BuildOptions = {}): { summary: string } {
  const root = options.root ?? DEFAULT_ROOT;
  if (typeof stripTypeScriptTypes !== "function") {
    fail("node:module", "stripTypeScriptTypes is missing — the kanban build needs Node >= 22.13");
  }
  if (options.generate !== false) {
    writeContractValues();
    checkContractValues();
  }
  const src = join(root, "src");
  const lib = join(root, "lib");
  // The stylesheet the client imports (T035): the authored `src/client/styles.css`
  // plus the generated grayscale rules (F121-FR-013). Generated as TypeScript so
  // the same module loads in Node (the tests) and in the browser bundle; the
  // build holds it equal to its inputs.
  const stylesPath = join(src, "client", "styles.css");
  const generatedStyles = existsSync(stylesPath)
    ? `// GENERATED by scripts/build-kanban.ts — do not edit. src/client/styles.css + the grayscale rules of contracts/kanban-closed-sets.json\nconst css = ${JSON.stringify(`${readFileSync(stylesPath, "utf8").replace(/\s*$/, "\n")}\n${grayRules()}\n`)};\nexport default css;\n`
    : null;
  if (generatedStyles !== null) {
    const target = join(src, "client", "generated-styles.ts");
    if (!existsSync(target) || readFileSync(target, "utf8") !== generatedStyles) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, generatedStyles, "utf8");
    }
  }
  // Output is collected, then written idempotently: builds run concurrently (the test suite
  // runs the root build while other files run), so lib/ is never removed wholesale.
  const outputs = new Map<string, string>();

  let serverFiles = 0;
  for (const area of ["server", "shared"]) {
    for (const name of sourcesUnder(join(src, area), ".ts")) {
      const file = `src/${area}/${name}`;
      const code = toEsmJs(file, strip(file, readFileSync(join(src, area, name), "utf8")));
      outputs.set(`${area}/${name.replace(/\.ts$/, ".js")}`, code);
      serverFiles += 1;
    }
  }
  const client = clientBundle(root);
  outputs.set("client.js", client.text);
  writeOutputs(lib, outputs);

  const findings = scanTree(root);
  if (findings.length > 0) {
    const first = findings[0]!;
    throw new Error(`${first.file}: static scan failed — ${formatFinding(first)}${findings.length > 1 ? ` (+${findings.length - 1} more)` : ""}`);
  }
  return {
    summary:
      `build ok: ${serverFiles} server/shared file(s), client bundle ${Buffer.byteLength(client.text)} bytes ` +
      `(${client.modules} module(s)) — kanban plugin built, checks passed`,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(buildKanban().summary);
  } catch (error) {
    console.error(`build-kanban: ${(error as Error).message}`);
    process.exit(1);
  }
}
