/**
 * T023 [US4] — the manifest range held against the pinned engine
 * (F120-FR-012, F120-FR-022; G-A).
 *
 * The pinned CLI's `--protocol` integer (read with the kit `readProtocol`)
 * sits inside `specstride.protocol` `{"min":1,"max":1}`, declared ONCE, in the
 * root `package.json` (the manifest). The range is tested against exactly the
 * engine release `specstride.engineVersion` names, which is the release the
 * root `core-pin.json` records. The shim declares the range nowhere else: a
 * scan of `src/` and `scripts/` finds no protocol-range declaration.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PROTOCOL_FLAG, readProtocol, protocolIsSupported, supportedRange } from "@specstride/host-kit/shim";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  version: string;
  specstride?: { protocol?: { min: number; max: number }; engineVersion?: string };
};
const PIN = JSON.parse(readFileSync(join(ROOT, "core-pin.json"), "utf8")) as {
  version: string;
  packages: { name: string; version: string }[];
};

function* filesUnder(directory: string): Generator<string> {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) yield* filesUnder(path);
    else yield path;
  }
}

test("the manifest declares the range once: specstride.protocol {min:1,max:1}", () => {
  assert.deepEqual(MANIFEST.specstride!.protocol, { min: 1, max: 1 });
  // The kit's supportedRange() writes it the same way the refusal line does.
  assert.equal(supportedRange(), "1");
});

test("the pinned CLI's --protocol integer sits inside the manifest range", () => {
  const bin = JSON.parse(
    readFileSync(join(ROOT, "node_modules", "specstride", "package.json"), "utf8"),
  ).bin.specstride as string;
  const cli = join(ROOT, "node_modules", "specstride", bin);
  const run = spawnSync(process.execPath, [cli, PROTOCOL_FLAG], { encoding: "utf8" });
  assert.equal(run.status, 0, `--protocol failed: ${run.stderr}`);
  const protocol = readProtocol(run.stdout);
  assert.notEqual(protocol, null, `not one integer: ${JSON.stringify(run.stdout)}`);
  const { min, max } = MANIFEST.specstride!.protocol!;
  assert.ok(protocol! >= min && protocol! <= max, `protocol ${protocol} outside [${min},${max}]`);
  // The kit's own predicate agrees.
  assert.equal(protocolIsSupported(protocol), true);
});

test("the range is tested against exactly the engine release core-pin.json records", () => {
  const engineVersion = MANIFEST.specstride!.engineVersion!;
  assert.equal(engineVersion, PIN.version);
  const pinned = PIN.packages.find((p) => p.name === "specstride");
  assert.equal(pinned!.version, engineVersion);
  const installed = JSON.parse(
    readFileSync(join(ROOT, "node_modules", "specstride", "package.json"), "utf8"),
  ).version as string;
  assert.equal(installed, engineVersion);
});

test("the shim declares the range nowhere else: no protocol-range declaration in src/ or scripts/", () => {
  // The manifest is the one place (F120-FR-012). Neither tree may hold the
  // kit's inlined constants or a min/max protocol range of its own.
  const declaration = /SUPPORTED_PROTOCOL_(MIN|MAX)|["']?protocol["']?\s*:\s*\{[^}]*min/;
  for (const tree of ["src", "scripts"]) {
    for (const path of filesUnder(join(ROOT, tree))) {
      const text = readFileSync(path, "utf8");
      assert.doesNotMatch(text, declaration, `${path} declares the protocol range`);
    }
  }
});
