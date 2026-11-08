/**
 * T031 — PT-121-012 (F121-FR-012): scoping and text-only insertion.
 *
 * The scan rules (c) and (d) of T008 hold on the built bundle:
 *   (c) css-selector — every selector of the built CSS in `lib/client.js`
 *       (the generated stylesheet module and the `styles.css` module) starts
 *       with the `.ssk-<8 hex>` prefix and reaches neither `:root`, `html`,
 *       `body` nor `*`, and the sheet carries no `@import`, `@font-face` or
 *       `prefers-color-scheme`;
 *   (d) markup-sink — the `markup-text` view enters the board tree with
 *       `<script>` and `<img onerror>` held as text and U+0007 replaced by
 *       U+FFFD, and the React adapter of the built bundle receives them as
 *       string children only — no attribute is a handler or a markup sink.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { formatFinding, scanTree } from "../../scripts/scan.ts";
import { boardTree } from "../../src/shared/board-tree.ts";
import type { Node as TreeNode } from "../../src/shared/tree.ts";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..", "..");
const bundlePath = join(packageRoot, "lib", "client.js");
const bundle = readFileSync(bundlePath, "utf8");
const view = JSON.parse(
  readFileSync(join(packageRoot, "tests", "fixtures", "views", "markup-text.json"), "utf8"),
) as Record<string, unknown>;

/* ------------------------- rule (c): the built stylesheet ------------------------- */

/** Every selector of the sheet, top-level preludes only (keyframe steps are not selectors). */
function selectorsOf(css: string): string[] {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < code.length; i += 1) {
    const character = code[i];
    if (character === "{") {
      if (depth === 0) out.push(code.slice(start, i).trim());
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) start = i + 1;
    }
  }
  return out;
}

/** Rule (c) of T008, restated: the prefix, no page reach, no @import/@font-face/prefers-color-scheme. */
function selectorFindings(css: string): string[] {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  const found: string[] = [];
  if (/@import\b/.test(code)) found.push("@import is refused");
  if (/@font-face\b/.test(code)) found.push("@font-face is refused");
  if (/prefers-color-scheme/.test(code)) found.push("prefers-color-scheme is refused");
  for (const selector of selectorsOf(css).flatMap((prelude) => prelude.split(",").map((part) => part.trim()))) {
    if (!/^\.ssk-[0-9a-f]{8}(?![\w-])/.test(selector)) found.push(`selector "${selector}" does not start with the .ssk-<8 hex> prefix`);
    else if (/(^|[\s>+~])(:root|html|body)\b/.test(selector)) found.push(`selector "${selector}" reaches the page`);
  }
  return found;
}

/** The two embedded stylesheet string literals of the bundle, unescaped. */
function builtStylesheets(): string[] {
  const literals = [...bundle.matchAll(/(?:const css = |module\.exports = )("(?:[^"\\]|\\.)*");/g)].map((match) =>
    vm.runInNewContext(match[1] as string, {}, { timeout: 1000 }),
  ) as string[];
  return literals;
}

test("every selector of the built CSS in lib/client.js starts with the .ssk-<8 hex> prefix (rule c)", () => {
  const sheets = builtStylesheets();
  assert.ok(sheets.length >= 2, `expected the generated sheet and the styles.css module; got ${sheets.length}`);
  assert.ok(sheets[0]?.includes('[data-gray='), "the generated sheet carries the grayscale rules");
  for (const sheet of sheets) {
    const selectors = selectorsOf(sheet);
    assert.ok(selectors.length > 0, "the built sheet has selectors");
    assert.deepEqual(selectorFindings(sheet), [], selectorFindings(sheet).join("; "));
    assert.ok(
      selectors.every((selector) => selector.split(",").every((part) => part.trim().startsWith(".ssk-00000000"))),
      "every selector is scoped under the neutral placeholder prefix",
    );
  }
});

test("the scan rules (c) and (d) of T008 hold on the real tree", () => {
  const findings = scanTree(packageRoot).filter((finding) => finding.rule === "css-selector" || finding.rule === "markup-sink");
  assert.deepEqual(findings.map(formatFinding), []);
});

/* ------------------------- rule (d): text-only insertion -------------------------- */

type FlatNode = { tag: string; attrs: Readonly<Record<string, string>>; text?: string; children: readonly FlatNode[] };

function flatten(node: TreeNode): FlatNode[] {
  return [{ tag: node.tag, attrs: node.attrs, text: node.text, children: node.children as FlatNode[] }, ...node.children.flatMap(flatten)];
}

const tree = boardTree(view as never);
const nodes = flatten(tree);
const texts = nodes.flatMap((node) => (node.text === undefined ? [] : [node.text]));

test("the markup-text view keeps <script> and <img onerror> as text, never as markup (rule d)", () => {
  assert.ok(texts.some((text) => text.includes("<script>alert(1)</script>")), "the <script> string is a text node");
  assert.ok(texts.some((text) => text.includes("<img src=x onerror=alert(1)>")), "the <img onerror> string is a text node");
  const serialized = JSON.stringify(tree);
  for (const node of nodes) {
    for (const name of Object.keys(node.attrs)) {
      assert.ok(!/^(innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML)$/.test(name) && !name.startsWith("on"), `attribute ${name} is a markup sink or a handler`);
      assert.equal(typeof node.attrs[name], "string", `attribute ${name} is a string`);
    }
    assert.ok(node.text === undefined || node.children.length === 0, "a node never holds both text and children");
  }
  assert.ok(serialized.includes("<script>alert(1)</script>"), "the serialized tree carries the script string as JSON text");
});

test("U+0007 of the markup-text view arrives as U+FFFD, never raw", () => {
  const serialized = JSON.stringify(tree);
  assert.ok(!serialized.includes("\u0007"), "no raw U+0007 anywhere in the tree");
  assert.ok(texts.some((text) => text.includes("bell\uFFFDfeature")), "the bell feature keeps its text with U+FFFD in place of U+0007");
  assert.ok(texts.some((text) => text.includes("<script>x</script> <img onerror=y>") && text.includes("\uFFFD")), "the attention one line keeps its markup strings as text and its U+0007 as U+FFFD");
  assert.ok(texts.some((text) => text.includes("<b>need</b>")), "the attention need line stays text");
});

/* -------------------- the built React adapter: string children only -------------------- */

type Element = { tag: string; props: Record<string, unknown>; children: unknown[] };

function fakeReact(): { react: { createElement: (...args: unknown[]) => unknown }; elements: Element[] } {
  const elements: Element[] = [];
  const react = {
    createElement: (...args: unknown[]) => {
      const [tag, props, ...children] = args as [string, Record<string, unknown>, ...unknown[]];
      const element = { tag, props: { ...props }, children };
      elements.push(element);
      return element;
    },
  };
  return { react, elements };
}

/** The bundle's module object, captured the way the host loader receives it. */
function loadBundle(): { factory: (require: (id: string) => unknown) => unknown } {
  let spec: { factory: (require: (id: string) => unknown) => unknown } | undefined;
  vm.runInNewContext(
    bundle,
    {
      window: { __ModuleLoader__: { load: (loaded: typeof spec) => (spec = loaded) } },
      AbortController,
      fetch: () => Promise.reject(new Error("no network in this test")),
    },
    { timeout: 5000 },
  );
  assert.ok(spec !== undefined, "the bundle registers one module with the host loader");
  return spec as { factory: (require: (id: string) => unknown) => unknown };
}

test("the built React adapter receives the markup-text tree as string children only", () => {
  const { react, elements } = fakeReact();
  const mod = loadBundle().factory(() => undefined) as { toReact?: (node: TreeNode, reactInstance: unknown) => unknown };
  assert.equal(typeof mod.toReact, "function", "the bundle exports the React adapter");
  mod.toReact?.(tree, react);
  assert.ok(elements.length > 0, "the adapter produced elements");

  const strings: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      strings.push(value);
      return;
    }
    assert.ok(value !== null && typeof value === "object" && "tag" in (value as Element), "every child is a string or an element");
    const element = value as Element;
    for (const [name, prop] of Object.entries(element.props)) {
      assert.ok(!/^(innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML)$/.test(name) && !name.startsWith("on"), `prop ${name} is a markup sink or a handler`);
      assert.ok(name === "key" || typeof prop === "string", `prop ${name} is a plain string`);
      assert.ok(!(typeof prop === "string" && /__html/.test(prop)), "no __html object anywhere");
    }
    element.children.forEach(walk);
  };
  elements.forEach(walk);

  assert.ok(strings.some((text) => text.includes("<script>alert(1)</script>")), "the <script> string reaches React as a string child");
  assert.ok(strings.some((text) => text.includes("<img src=x onerror=alert(1)>")), "the <img onerror> string reaches React as a string child");
  assert.ok(strings.some((text) => text.includes("\uFFFD")), "the U+0007 replacement reaches React as U+FFFD text");
  assert.ok(strings.every((text) => !text.includes("\u0007")), "no raw U+0007 reaches React");
  assert.ok(!JSON.stringify(elements).includes("dangerouslySetInnerHTML"), "no dangerouslySetInnerHTML anywhere in the rendered elements");
});

test("the built bundle is a cordis plugin {inject, apply} with no default export (loader regression)", () => {
  // The dsh loader's unwrapExports takes `exports.default ?? exports`: a default
  // export would hide `inject`, and the first ctx.locale read would throw
  // 'cannot get property "locale" without inject'.
  const mod = loadBundle().factory(() => undefined) as { default?: unknown; inject?: unknown; apply?: unknown };
  assert.equal(mod.default, undefined, "no default export");
  assert.equal(typeof mod.apply, "function", "apply is exported");
  assert.ok(Array.isArray(mod.inject), "inject is exported");
  for (const service of ["slots", "locale"]) assert.ok((mod.inject as string[]).includes(service), `inject declares ${service}`);
});
