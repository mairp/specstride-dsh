/**
 * T008 — the static scans (F121-FR-006, F121-FR-009, F121-FR-011, F121-FR-012;
 * research.md R7, R8). Run by the kanban build stage over `src/` and `lib/`.
 *
 * Rules (the `rule` field of a finding):
 *   no-lane-assignment  a lane assigned in source; `columnOf` reads only `card.lane`
 *   css-colour          a colour-bearing property takes anything but var(--dsw-…) (or a color-mix of those only)
 *   css-selector        a selector without the `.ssk-<8 hex>` prefix, :root/html/body/*, @import, @font-face, prefers-color-scheme
 *   markup-sink         innerHTML, outerHTML, insertAdjacentHTML, dangerouslySetInnerHTML, document.write, eval, new Function
 *   nondeterminism      Math.random, Date, performance.now in src/shared/
 *   install-script      preinstall/install/postinstall/prepare in the plugin manifest
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { LANES } from "../src/shared/generated/contract-values.ts";

export type Finding = { rule: string; file: string; line: number; detail: string };

export const RULES = ["no-lane-assignment", "css-colour", "css-selector", "markup-sink", "nondeterminism", "install-script"] as const;

function filesUnder(directory: string, extensions: readonly string[]): string[] {
  if (!existsSync(directory)) return [];
  return (readdirSync(directory, { recursive: true }) as string[])
    .map(String)
    .filter((name) => extensions.some((extension) => name.endsWith(extension)))
    .sort()
    .map((name) => join(directory, name));
}

/** Comments blanked, newlines kept, so line numbers stay true. */
function stripComments(text: string): string {
  const blank = (match: string) => match.replace(/[^\n]/g, " ");
  return text.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:"'`\\])\/\/.*$/gm, (match, lead: string) => lead + " ".repeat(match.length - lead.length));
}

function eachLine(text: string, visit: (line: string, number: number) => void): void {
  text.split("\n").forEach((line, index) => visit(line, index + 1));
}

/* ------------------------------ rule: lane assignment ----------------------------- */

const LANE_ASSIGNMENT = [/\blane\s*[:=](?!=)\s*["'`]/, /\.lane\s*=(?!=)/];

/** The body of `columnOf` (function or arrow), by paren and brace matching; null when absent. */
function columnOfBody(code: string): { body: string; line: number } | null {
  const start = /function\s+columnOf\b|\bcolumnOf\s*=/.exec(code);
  if (start === null) return null;
  const match = (from: number, open: string, close: string): number => {
    let depth = 0;
    for (let i = from; i < code.length; i += 1) {
      if (code[i] === open) depth += 1;
      else if (code[i] === close) {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    return -1;
  };
  let from: number;
  if (start[0].startsWith("function")) {
    const parenOpen = code.indexOf("(", start.index);
    const parenClose = parenOpen < 0 ? -1 : match(parenOpen, "(", ")");
    from = parenClose < 0 ? -1 : code.indexOf("{", parenClose);
  } else {
    const arrow = code.indexOf("=>", start.index);
    if (arrow < 0) return null;
    const rest = code.slice(arrow + 2);
    const lead = rest.length - rest.trimStart().length;
    if (rest.trimStart().startsWith("{")) from = arrow + 2 + lead;
    else {
      const end = rest.search(/;|\n\s*\n/);
      const stop = arrow + 2 + (end < 0 ? rest.length : end);
      return { body: code.slice(arrow + 2, stop), line: code.slice(0, arrow).split("\n").length };
    }
  }
  if (from < 0) return null;
  const close = match(from, "{", "}");
  if (close < 0) return null;
  return { body: code.slice(from, close + 1), line: code.slice(0, from).split("\n").length };
}

/** Server files that build a view (lanes included); exempt from no-lane-assignment only. */
export const VIEW_PRODUCERS = ["src/server/workspace-view.ts", "lib/server/workspace-view.js"] as const;

function scanLanes(file: string, text: string, root: string): Finding[] {
  const path = relative(root, file).split(sep).join("/");
  if (path.includes("src/shared/generated/")) return [];
  // The workspace reader is a view PRODUCER (it stands in for the engine when
  // none answers), so it assigns lanes by design. The rule still holds for every
  // consumer: the client, the shared board model and the rest of the server.
  if (VIEW_PRODUCERS.some((producer) => path.endsWith(producer))) return [];
  const code = stripComments(text);
  const found: Finding[] = [];
  const cases = new RegExp(`\\bcase\\s+["'\`](?:${LANES.join("|")})["'\`]\\s*:`);
  eachLine(code, (line, number) => {
    if (LANE_ASSIGNMENT.some((pattern) => pattern.test(line)) || cases.test(line)) {
      found.push({ rule: "no-lane-assignment", file: path, line: number, detail: line.trim() });
    }
  });
  if (path.endsWith("src/shared/board-model.ts")) {
    const column = columnOfBody(code);
    if (column === null) {
      found.push({ rule: "no-lane-assignment", file: path, line: 1, detail: "board-model.ts has no columnOf function" });
    } else {
      for (const access of column.body.matchAll(/([A-Za-z_$][\w$]*)\s*\??\.\s*([A-Za-z_$][\w$]*)/g)) {
        if (access[1] !== "card" || access[2] !== "lane") {
          found.push({
            rule: "no-lane-assignment",
            file: path,
            line: column.line + column.body.slice(0, access.index).split("\n").length - 1,
            detail: `columnOf reads ${access[0]} — a column is chosen from card.lane only`,
          });
        }
      }
    }
  }
  return found;
}

/* ------------------------------ rules: stylesheet --------------------------------- */

const COLOUR_PROPERTY = /^(color|background|background-color|border(-(top|right|bottom|left))?(-color)?|outline(-color)?|fill|stroke|box-shadow|text-decoration|text-decoration-color|caret-color|accent-color)$/;
const NAMED_COLOURS = new Set(
  ("aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato transparent turquoise violet wheat white whitesmoke yellow yellowgreen").split(" "),
);
const DSW_VAR = /var\(\s*--dsw-[\w-]+\s*(?:,\s*var\(\s*--dsw-[\w-]+\s*\)\s*)?\)/g;

/** A `color-mix(in srgb, …)` whose operands, once the `--dsw-` vars are gone, are only percentages. */
const DSW_ONLY_MIX = /color-mix\(\s*in\s+srgb\s*,[\s\d.%,]*\)/gi;

function colourProblem(value: string): string | null {
  let rest = value.replace(DSW_VAR, " ");
  // Mixing two host tokens declares no colour of the plugin's own (the
  // Trajectory tab's violet is one); innermost first, so nesting reduces too.
  for (let before = ""; before !== rest; ) {
    before = rest;
    rest = rest.replace(DSW_ONLY_MIX, " ");
  }
  if (/#[0-9a-f]{3,8}\b/i.test(rest)) return "hex colour";
  if (/\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/i.test(rest)) return "colour function";
  if (/var\(/i.test(rest)) return "var() outside --dsw-";
  for (const word of rest.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (NAMED_COLOURS.has(word)) return `named colour ${word}`;
  }
  return null;
}

const PREFIX = /^\.ssk-[0-9a-f]{8}(?![\w-])/;

function scanStyles(file: string, text: string, root: string): Finding[] {
  const path = relative(root, file).split(sep).join("/");
  const code = stripComments(text);
  const found: Finding[] = [];
  const lineAt = (index: number) => code.slice(0, index).split("\n").length;
  const add = (rule: string, index: number, detail: string) => found.push({ rule, file: path, line: lineAt(index), detail });

  let i = 0;
  const skipBlock = (open: number): number => {
    let depth = 0;
    for (let k = open; k < code.length; k += 1) {
      if (code[k] === "{") depth += 1;
      else if (code[k] === "}") {
        depth -= 1;
        if (depth === 0) return k + 1;
      }
    }
    return code.length;
  };
  const declarations = (from: number, to: number) => {
    for (const declaration of code.slice(from, to).matchAll(/([a-z-]+)\s*:\s*([^;{}]+)/gi)) {
      const property = (declaration[1] as string).toLowerCase();
      if (COLOUR_PROPERTY.test(property)) {
        const problem = colourProblem(declaration[2] as string);
        if (problem !== null) add("css-colour", from + (declaration.index ?? 0), `${property}: ${(declaration[2] as string).trim()} — ${problem}`);
      }
    }
  };
  const parse = (end: number) => {
    while (i < end) {
      const next = code.slice(i).search(/[{};]/);
      if (next < 0) return;
      const at = i + next;
      const prelude = code.slice(i, at).trim();
      if (code[at] === "}") { i = at + 1; return; }
      if (code[at] === ";") {
        if (/^@import\b/.test(prelude)) add("css-selector", i + code.slice(i).search(/\S/), "@import is refused");
        i = at + 1;
        continue;
      }
      const preludeAt = i + code.slice(i).search(/\S/);
      if (prelude.startsWith("@")) {
        if (/^@(import|font-face)\b/.test(prelude)) {
          add("css-selector", preludeAt, `${prelude.split(/\s/)[0]} is refused`);
          i = skipBlock(at);
        } else if (/^@media[^{]*prefers-color-scheme/i.test(prelude)) {
          add("css-selector", preludeAt, "@media (prefers-color-scheme) is refused");
          i = skipBlock(at);
        } else if (/^@(media|supports|layer)\b/.test(prelude)) {
          i = at + 1;
          parse(end);
        } else {
          i = skipBlock(at); // @keyframes and the like: no selectors of ours
        }
        continue;
      }
      for (const selector of prelude.split(",").map((part) => part.trim())) {
        if (!PREFIX.test(selector)) add("css-selector", preludeAt, `selector "${selector}" does not start with the .ssk-<8 hex> prefix`);
        else if (/(^|[\s>+~])(:root|html|body)\b/.test(selector)) add("css-selector", preludeAt, `selector "${selector}" reaches the page`);
      }
      const close = skipBlock(at);
      declarations(at + 1, close - 1);
      i = close;
    }
  };
  parse(code.length);
  return found;
}

/* ------------------------------ rules: sources, manifest -------------------------- */

const SINKS: readonly [RegExp, string][] = [
  [/\.\s*(innerHTML|outerHTML|insertAdjacentHTML)\b/, "markup sink"],
  [/\b(innerHTML|outerHTML|dangerouslySetInnerHTML)\s*[:=](?!=)/, "markup sink"],
  [/\[\s*["'`](innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML)["'`]\s*\]/, "markup sink"],
  [/\bdocument\s*\.\s*write(ln)?\b/, "document.write"],
  [/(^|[^.\w$])eval\s*\(/, "eval"],
  [/\bnew\s+Function\b/, "new Function"],
];

function scanSinks(file: string, text: string, root: string): Finding[] {
  const path = relative(root, file).split(sep).join("/");
  const found: Finding[] = [];
  eachLine(stripComments(text), (line, number) => {
    for (const [pattern, name] of SINKS) {
      if (pattern.test(line)) found.push({ rule: "markup-sink", file: path, line: number, detail: `${name}: ${line.trim()}` });
    }
  });
  return found;
}

function scanNondeterminism(file: string, text: string, root: string): Finding[] {
  const path = relative(root, file).split(sep).join("/");
  const found: Finding[] = [];
  eachLine(stripComments(text), (line, number) => {
    if (/\bMath\s*\.\s*random\b|\bDate\b|\bperformance\s*\.\s*now\b/.test(line)) {
      found.push({ rule: "nondeterminism", file: path, line: number, detail: line.trim() });
    }
  });
  return found;
}

const INSTALL_SCRIPTS = ["preinstall", "install", "postinstall", "prepare"];

function scanManifest(file: string, text: string, root: string): Finding[] {
  const path = relative(root, file).split(sep).join("/");
  const scripts = (JSON.parse(text) as { scripts?: Record<string, string> }).scripts ?? {};
  return INSTALL_SCRIPTS.filter((name) => name in scripts).map((name) => ({
    rule: "install-script",
    file: path,
    line: 1,
    detail: `the manifest has a "${name}" script`,
  }));
}

/** All findings over `<root>/src`, `<root>/lib` and `<root>/package.json`. */
export function scanTree(root: string): Finding[] {
  const findings: Finding[] = [];
  for (const directory of ["src", "lib"]) {
    for (const file of filesUnder(join(root, directory), [".ts", ".js", ".mjs"])) {
      if (file.endsWith(".d.ts")) continue;
      const text = readFileSync(file, "utf8");
      findings.push(...scanLanes(file, text, root), ...scanSinks(file, text, root));
      if (directory === "src" && relative(root, file).split(sep).join("/").startsWith("src/shared/")) {
        findings.push(...scanNondeterminism(file, text, root));
      }
    }
  }
  for (const file of filesUnder(join(root, "src"), [".css"])) {
    findings.push(...scanStyles(file, readFileSync(file, "utf8"), root));
  }
  const manifest = join(root, "package.json");
  if (existsSync(manifest)) findings.push(...scanManifest(manifest, readFileSync(manifest, "utf8"), root));
  return findings;
}

export function formatFinding(finding: Finding): string {
  return `${finding.file}:${finding.line} [${finding.rule}] ${finding.detail}`;
}
