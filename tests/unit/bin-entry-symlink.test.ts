/**
 * The control CLI runs when started through a symlink, as npm links every
 * package bin (`npm install -g`, `npx`, node_modules/.bin). Before the fix
 * the entry guard compared argv[1] with the module path, so a linked
 * `specstride-host-dsh` printed nothing and exited 0.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BIN = join(ROOT, "bin", "specstride-host-dsh.mjs");

for (const [label, path] of [
  ["direct", BIN],
  ["through a symlink", (() => {
    const link = join(mkdtempSync(join(tmpdir(), "host-dsh-bin-")), "specstride-host-dsh");
    symlinkSync(BIN, link);
    return link;
  })()],
] as const) {
  test(`--help prints the usage and exits 2 (${label})`, () => {
    const run = spawnSync(process.execPath, [path, "--help"], { encoding: "utf8" });
    assert.equal(run.status, 2);
    assert.match(run.stdout, /^usage: specstride-host-dsh /);
  });
}
