/**
 * T007 — the kanban build stage. The stage runs on a synthetic package tree in a
 * temporary directory (the real `src/server/entry.ts` and `src/client/index.ts` belong
 * to later tasks), plus once on the real package.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { buildKanban, EXTERNALS, PLUGIN_ID } from "../../scripts/build-kanban.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function syntheticTree(extra: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "kb-"));
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  cpSync(join(packageRoot, "src", "shared"), join(root, "src", "shared"), { recursive: true });
  write("src/server/entry.ts", 'import { start } from "./index.ts";\nexport function apply(ctx: unknown): void {\n  start(ctx);\n}\n');
  write("src/server/index.ts", "export function start(_ctx: unknown): string {\n  return \"started\";\n}\n");
  write(
    "src/client/index.ts",
    [
      'import React from "react";',
      'import { useSlot } from "@deepseek-ai/dsh-client-runtime/client";',
      'import { el } from "../shared/tree.ts";',
      'import css from "./styles.css";',
      "export const css_text: string = css;",
      "export function make(): string {",
      '  return JSON.stringify([typeof React, typeof useSlot, el("div").tag]);',
      "}",
      "export default make;",
      "",
    ].join("\n"),
  );
  write("src/client/styles.css", ".ssk-0a1b2c3d { color: var(--dsw-alias-text); }\n");
  for (const [path, text] of Object.entries(extra)) write(path, text);
  return root;
}

function libFiles(root: string): Record<string, string> {
  const lib = join(root, "lib");
  return Object.fromEntries(
    (readdirSync(lib, { recursive: true }) as string[])
      .filter((name) => /\.js$/.test(name))
      .sort()
      .map((name) => [name, readFileSync(join(lib, name), "utf8")]),
  );
}

test("the bundle is one load call with the plugin id, first in the file; the externals are exactly two", () => {
  const root = syntheticTree();
  const { summary } = buildKanban({ root, generate: false });
  assert.match(summary, /^build ok: .*kanban plugin built, checks passed$/);
  const text = readFileSync(join(root, "lib", "client.js"), "utf8");
  assert.ok(text.startsWith("window.__ModuleLoader__.load({\n"), "the first statement is the load call");
  assert.equal(text.split("__ModuleLoader__.load(").length - 1, 1);
  assert.ok(text.includes(`id: ${JSON.stringify(PLUGIN_ID)}`));
  const externals = [...new Set([...text.matchAll(/\brequire\("([^"]+)"\)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(externals, [...EXTERNALS].sort());
});

test("the bundle runs: modules resolve, the CSS is inlined as a string, externals come from the loader's require", () => {
  const root = syntheticTree();
  buildKanban({ root, generate: false });
  const text = readFileSync(join(root, "lib", "client.js"), "utf8");
  let registered: { id: string; factory: (require: (name: string) => unknown) => Record<string, unknown> } | undefined;
  const required: string[] = [];
  vm.runInNewContext(text, { window: { __ModuleLoader__: { load: (spec: typeof registered) => (registered = spec) } } });
  assert.equal(registered?.id, PLUGIN_ID);
  const exports = registered!.factory((name) => {
    required.push(name);
    return name === "react" ? { default: {}, __esModule: false } : { useSlot: () => 1 };
  });
  assert.equal(exports.css_text, ".ssk-0a1b2c3d { color: var(--dsw-alias-text); }\n");
  assert.equal(typeof exports.make, "function");
  assert.equal(JSON.parse((exports.make as () => string)())[2], "div");
  assert.deepEqual([...new Set(required)].sort(), [...EXTERNALS].sort());
});

test("lib/server/entry.js exists as ESM with .js specifiers and no types", () => {
  const root = syntheticTree();
  buildKanban({ root, generate: false });
  assert.ok(existsSync(join(root, "lib", "server", "entry.js")));
  const entry = readFileSync(join(root, "lib", "server", "entry.js"), "utf8");
  assert.match(entry, /from "\.\/index\.js"/);
  assert.doesNotMatch(entry, /\.ts"|: unknown|: void/);
});

test("two builds are byte-equal", () => {
  const a = syntheticTree();
  const b = syntheticTree();
  buildKanban({ root: a, generate: false });
  buildKanban({ root: b, generate: false });
  assert.deepEqual(libFiles(a), libFiles(b));
  buildKanban({ root: a, generate: false });
  assert.deepEqual(libFiles(a), libFiles(b));
});

test("a failure names the file: a bare import, an enum, an unresolved import, a scan finding", () => {
  const cases: [string, string, RegExp][] = [
    ["src/client/bad-import.ts", 'import _ from "lodash";\nexport const x = _;\n', /src\/client\/bad-import\.ts|client\/bad-import\.ts: import "lodash"/],
    ["src/client/bad-enum.ts", "export enum E { A }\n", /bad-enum\.ts: TypeScript cannot be erased/],
    ["src/client/bad-resolve.ts", 'import { q } from "./nowhere.ts";\nexport const x = q;\n', /bad-resolve\.ts: import "\.\/nowhere\.ts"/],
    ["src/client/bad-sink.ts", "export const x = (n: { innerHTML: string }) => { n.innerHTML = \"\"; };\n", /bad-sink\.ts.*\[markup-sink\]/],
  ];
  for (const [path, text, pattern] of cases) {
    const root = syntheticTree({ [path]: text });
    assert.throws(() => buildKanban({ root, generate: false }), pattern, path);
  }
});

test("the real package builds: contract values checked, scans pass, one client bundle", () => {
  const { summary } = buildKanban();
  assert.match(summary, /^build ok: .*kanban plugin built, checks passed$/);
  const text = readFileSync(join(packageRoot, "lib", "client.js"), "utf8");
  assert.ok(text.startsWith("window.__ModuleLoader__.load({"));
  assert.ok(text.includes("shared/tree") && text.includes("shared/view-read"));
});
