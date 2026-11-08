/** T005 — the generated contract values equal a fresh generation; drift fails `--check`. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { LANES } from "@specstride/contracts/records/run-view";
import { GENERATED_PATH, checkContractValues, readPin, renderContractValues } from "../../scripts/gen-contract-values.ts";

const generator = fileURLToPath(new URL("../../scripts/gen-contract-values.ts", import.meta.url));

test("the generated file equals a fresh generation", () => {
  assert.equal(readFileSync(GENERATED_PATH, "utf8"), renderContractValues(readPin()));
  checkContractValues();
});

test("the header carries the core version and the contracts tarball sha256", () => {
  const pin = readPin();
  const sha = pin.packages.find((row) => row.name === "@specstride/contracts")!.sha256;
  const first = readFileSync(GENERATED_PATH, "utf8").split("\n")[0]!;
  assert.ok(first.includes(`core ${pin.version}`));
  assert.ok(first.includes(sha));
});

test("a tampered value fails --check, naming the value", () => {
  const dir = mkdtempSync(join(tmpdir(), "cv-"));
  const copy = join(dir, "contract-values.ts");
  writeFileSync(copy, readFileSync(GENERATED_PATH, "utf8").replace(`"${LANES[0]}"`, '"tampered"'));
  assert.throws(() => checkContractValues(copy), /drift at line \d+ \(value LANES\)/);
});

test("--check on the real file exits 0", () => {
  const run = spawnSync(process.execPath, ["--experimental-strip-types", generator, "--check"], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /contract-values: ok/);
});

test("the file contains no function and no import", () => {
  const text = readFileSync(GENERATED_PATH, "utf8");
  assert.doesNotMatch(text, /^\s*import\b/m);
  assert.doesNotMatch(text, /\bfunction\b|=>|\brequire\(|\bimport\(/);
});
