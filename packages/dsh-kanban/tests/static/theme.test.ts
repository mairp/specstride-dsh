/** T030 — PT-121-011 (F121-FR-011, F121-SC-002; research.md R8): theming.
 *
 * Three checks, all against recorded facts only:
 *  1. scan rule (b) of T008 (`css-colour`) on `src/client/styles.css`: every
 *     colour-bearing declaration takes a `var(--dsw-…)` of the host — the
 *     plugin declares no colour of its own.
 *  2. every `--dsw-*` token the stylesheet uses is in the recorded fixture
 *     `tests/fixtures/dsw-tokens.rc8.json`, and the background (`bg`) and
 *     label (`label`) tokens take different light and dark values there, so
 *     the board re-colours when the host switches theme
 *     (`body[data-ds-dark-theme]`) with no reload.
 *  3. the plugin source never reads `ctx.theme`, and rendering with a theme
 *     context is byte-identical to rendering without one.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scanTree } from "../../scripts/scan.ts";
import { inject as clientInject, openPane } from "../../src/client/index.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const css = readFileSync(join(packageRoot, "src", "client", "styles.css"), "utf8");
const tokens = JSON.parse(
  readFileSync(join(packageRoot, "tests", "fixtures", "dsw-tokens.rc8.json"), "utf8"),
) as { pin: string; tokens: Record<string, { light: string; dark: string }> };

const usedTokens = [...css.matchAll(/var\(--(dsw-[a-z0-9-]+)\)/g)].map((m) => m[1]!);

test("rule (b) css-colour: styles.css takes only var(--dsw-…) colours", () => {
  const findings = scanTree(packageRoot).filter(
    (finding) => finding.rule === "css-colour" && finding.file.includes("src/client/styles.css"),
  );
  assert.deepEqual(findings.map((f) => `${f.file}:${f.line} ${f.detail}`), []);
});

test("every --dsw-* token used by styles.css is in the rc.8 fixture", () => {
  assert.ok(usedTokens.length > 0, "stylesheet uses no host tokens at all");
  const recorded = Object.keys(tokens.tokens);
  const unknown = usedTokens.filter((token) => !recorded.includes(token));
  assert.deepEqual(unknown, []);
});

test("the bg and label tokens take different light and dark values", () => {
  const themed = usedTokens.filter((token) => /-bg-|-label-/.test(token));
  assert.ok(themed.includes("dsw-alias-bg-base"));
  assert.ok(themed.includes("dsw-alias-label-primary"));
  const same: string[] = [];
  for (const token of themed) {
    const { light, dark } = tokens.tokens[token]!;
    if (light === dark) same.push(token);
  }
  assert.deepEqual(same, []);
});

test("the plugin source never reads ctx.theme", () => {
  const sources: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) sources.push(readFileSync(path, "utf8"));
    }
  };
  walk(join(packageRoot, "src"));
  const offenders = sources.filter((text) => /\.theme\b|\btheme\s*:/.test(text));
  assert.deepEqual(offenders, []);
});

const view = JSON.parse(
  readFileSync(join(packageRoot, "tests", "fixtures", "views", "one-feature-each-lane.json"), "utf8"),
) as Record<string, unknown>;
const fakeReact = { createElement: (type: unknown, props: Record<string, unknown>, ...children: unknown[]) => ({ type, props, children }) };

class Clock {
  #pending: { fn: () => void; at: number; handle: symbol }[] = [];
  setTimeout(fn: () => void, ms: number): unknown {
    const handle = Symbol("timer");
    this.#pending.push({ fn, at: ms, handle });
    return handle;
  }
  clearTimeout(handle: unknown): void {
    this.#pending = this.#pending.filter((timer) => timer.handle !== handle);
  }
  async advance(ms: number): Promise<void> {
    for (;;) {
      const due = this.#pending.filter((timer) => timer.at <= ms).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      this.#pending = this.#pending.filter((timer) => timer.handle !== due.handle);
      due.fn();
      for (let i = 0; i < 150; i += 1) await Promise.resolve();
    }
  }
}

test("rendering with a theme context is identical to rendering without one", async () => {
  const run = async (withTheme: boolean): Promise<unknown[]> => {
    const realFetch = globalThis.fetch;
    (globalThis as { fetch: unknown }).fetch = (async () =>
      ({ ok: true, status: 200, json: async () => ({ answer: "view", view }) })) as typeof fetch;
    const updates: unknown[] = [];
    const clock = new Clock();
    // The pane never sees ctx: a theme can reach it only through an injected
    // `theme` service, and the plugin declares none (asserted below).
    const host = withTheme ? { container: {}, update: (element: unknown) => updates.push(element), theme: { mode: "dark", dark: true } } : { container: {}, update: (element: unknown) => updates.push(element) };
    const pane = openPane(host, "s1", () => fakeReact, clock);
    await clock.advance(2_000);
    // enough microtask turns for the whole fetch → json → render chain
    for (let i = 0; i < 1_000; i += 1) await Promise.resolve();
    pane.dispose();
    (globalThis as { fetch: unknown }).fetch = realFetch;
    return updates;
  };
  const withoutTheme = await run(false);
  const withTheme = await run(true);
  assert.ok(withoutTheme.length > 0, "nothing rendered without a theme in ctx");
  assert.deepEqual(withTheme, withoutTheme);
  assert.ok(!clientInject.includes("theme"), "the client injects no theme service");
});
