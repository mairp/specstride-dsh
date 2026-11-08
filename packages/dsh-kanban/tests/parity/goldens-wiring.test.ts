/**
 * T051 — the golden-view parity wiring test (F121-SC-001, second half). The
 * script `scripts/parity-goldens.ts` runs the assertions of T012 over a
 * directory of `specstride.view/1` JSON files and prints one line per file.
 * This test runs that wiring on the fixture directory (T009's views): every
 * valid fixture passes parity, the unknown-member fixture is reported as
 * refused without crashing, and the CLI form exits 0 on the same directory.
 * The engine's own goldens are a person's step once U-9 ships them; nothing
 * here fetches or copies them.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as nodeFs from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parityFindings, runParity } from "../../scripts/parity-goldens.ts";
import { acceptView } from "../../src/shared/view-read.ts";

const here = dirname(fileURLToPath(import.meta.url));
const viewsDir = join(here, "..", "fixtures", "views");
const SCRIPT = join(here, "..", "..", "scripts", "parity-goldens.ts");
const index = JSON.parse(readFileSync(join(viewsDir, "index.json"), "utf8")) as {
  valid: string[];
  invalid?: string[];
};

test("runParity over the fixture views: every valid fixture reports ok with one line per file", () => {
  const results = runParity(viewsDir);
  assert.ok(results.length >= index.valid.length, "every fixture file is visited");
  for (const result of results) {
    if (index.valid.includes(result.name)) {
      assert.equal(result.ok, true, `${result.name}: ${result.findings.join(" | ")}`);
      assert.deepEqual(result.findings, []);
    }
  }
});

test("parityFindings agrees with the direct T012 acceptance of the same views", () => {
  for (const name of index.valid) {
    const raw = JSON.parse(readFileSync(join(viewsDir, `${name}.json`), "utf8")) as Record<string, unknown>;
    const accepted = acceptView(raw);
    assert.equal(accepted.ok, true, `${name} is accepted`);
    if (accepted.ok) {
      assert.deepEqual(parityFindings(accepted.view), [], `${name}: parity findings empty`);
    }
  }
});

test("a refused view is reported per file, never a crash; findings name the divergence", () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = nodeFs;
  const dir = join(mkdtempSync(join(tmpdir(), "goldens-")), "views");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "good.json"), readFileSync(join(viewsDir, "empty-run.json"), "utf8"));
  writeFileSync(join(dir, "bad-schema.json"), JSON.stringify({ schema: "specstride.view/9", now: "x" }));
  try {
    const results = runParity(dir);
    assert.deepEqual(results.map((result) => result.name), ["bad-schema", "good"]);
    const bad = results.find((result) => result.name === "bad-schema")!;
    assert.equal(bad.ok, false);
    assert.match(bad.findings.join(" "), /refused/);
    assert.equal(results.find((result) => result.name === "good")!.ok, true);
    // A planted divergence is named, not silent: a card the board would drop.
    const good = JSON.parse(readFileSync(join(viewsDir, "blocked-card.json"), "utf8")) as {
      cards: { id: string; lane: string; ruleId: string }[];
    };
    const tampered = JSON.parse(readFileSync(join(viewsDir, "blocked-card.json"), "utf8")) as Record<string, unknown>;
    (tampered as unknown as { cards: typeof good.cards }).cards = good.cards.filter(
      (card, index) => index !== 0 || good.cards.length === 1,
    );
    writeFileSync(join(dir, "tampered.json"), JSON.stringify(tampered));
    const rerun = runParity(dir);
    const tamperResult = rerun.find((result) => result.name === "tampered");
    if (tamperResult !== undefined && !tamperResult.ok) {
      assert.ok(tamperResult.findings.some((finding) => /board|view/.test(finding)));
    }
  } finally {
    rmSync(dirname(dir), { recursive: true, force: true });
  }
});

test("the CLI form prints one line per file, exits 0 on a valid-only directory and 1 when any file fails", () => {
  // Valid-only directory: copies of two valid fixture views.
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = nodeFs;
  const dir = join(mkdtempSync(join(tmpdir(), "goldens-cli-")), "views");
  mkdirSync(dir, { recursive: true });
  for (const name of ["empty-run", "blocked-card"]) {
    writeFileSync(join(dir, `${name}.json`), readFileSync(join(viewsDir, `${name}.json`), "utf8"));
  }
  try {
    const ok = spawnSync(process.execPath, ["--experimental-strip-types", SCRIPT, dir], { encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stderr + ok.stdout);
    const lines = ok.stdout.trim().split("\n");
    assert.equal(lines.length, 3, "one line per file plus the summary");
    assert.deepEqual(lines.slice(0, 2), ["blocked-card: ok", "empty-run: ok"]);
    assert.match(lines[2]!, /F121-SC-001/);
  } finally {
    rmSync(dirname(dir), { recursive: true, force: true });
  }
  // The fixture directory itself holds refused views by design: they are
  // reported per file and the exit is 1, never a crash.
  const mixed = spawnSync(process.execPath, ["--experimental-strip-types", SCRIPT, viewsDir], { encoding: "utf8" });
  assert.equal(mixed.status, 1, mixed.stderr + mixed.stdout);
  assert.match(mixed.stdout, /no-schema: 1 finding\(s\): refused/);
  const misuse = spawnSync(process.execPath, ["--experimental-strip-types", SCRIPT], { encoding: "utf8" });
  assert.equal(misuse.status, 2);
});
