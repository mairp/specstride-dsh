/** T010 — the stub CLI, driven through 120's real shim, and held byte-equal to the pinned CLI. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..", "..");
const stub = join(here, "..", "fixtures", "stub-cli.mjs");
const shim = join(root, "bin", "specstride.mjs");
const pinned = join(root, "node_modules", "specstride", "bin", "specstride");

function scratch(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), "stub-")));
}
function runStub(args: string[], steps: unknown[], extra: Record<string, unknown> = {}, cwd = scratch()) {
  const dir = scratch();
  const script = join(dir, "script.json");
  const log = join(dir, "log.jsonl");
  writeFileSync(script, JSON.stringify({ steps, ...extra }));
  const run = (argv: string[]) =>
    spawnSync(process.execPath, [shim, ...argv], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, SPECSTRIDE_BIN: stub, STUB_SCRIPT: script, STUB_LOG: log },
    });
  return { run, log, cwd, first: args.length > 0 ? run(args) : null };
}
const lines = (log: string) => readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { argv: string[]; cwd: string; probe: boolean });

test("the shim probes --protocol (scripted integer, default 1), then runs the verb; every argv and cwd is logged", () => {
  const view = { schema: "specstride.view/1" };
  const { first, log, cwd } = runStub(["status", "--json"], [{ view }]);
  assert.equal(first!.status, 0, first!.stderr);
  assert.deepEqual(JSON.parse(first!.stdout), view);
  const rows = lines(log);
  assert.deepEqual(rows.map((r) => [r.argv.join(" "), r.probe]), [["--protocol", true], ["status --json", false]]);
  assert.equal(rows[1]!.cwd, cwd);
});

test("steps advance per call: view, no-state, no-feature, unchanged, changed line, exit 70", () => {
  const steps = [{ view: { a: 1 } }, "no-state", "no-feature", "unchanged", { changed: "run=r st=running cur=10.4.0a1b2c3d" }, { exit: 70 }];
  const { run } = runStub([], steps);
  const results = [
    run(["status", "--json"]),
    run(["status", "--json"]),
    run(["status", "--json"]),
    run(["wait", "--until-change", "--cursor", "1.2.0a1b2c3d", "--timeout", "1"]),
    run(["wait", "--until-change"]),
    run(["status", "--json"]),
  ];
  assert.deepEqual(results.map((r) => r.status), [0, 1, 1, 0, 0, 70]);
  assert.deepEqual(JSON.parse(results[0]!.stdout), { a: 1 });
  assert.match(results[1]!.stdout, /"reason":"no-state"/);
  assert.match(results[2]!.stdout, /"reason":"no-feature"/);
  assert.equal(results[3]!.stdout, "");
  assert.match(results[4]!.stdout, /cur=10\.4\.0a1b2c3d\n$/);
});

test("a scripted protocol other than 1 makes the shim refuse with exit 4", () => {
  const { first } = runStub(["status", "--json"], ["unchanged"], { protocol: 2 });
  assert.equal(first!.status, 4);
  assert.match(first!.stdout, /protocol-mismatch found=2/);
});

test("a hang step does not return", () => {
  const dir = scratch();
  const script = join(dir, "s.json");
  writeFileSync(script, JSON.stringify({ steps: ["hang"] }));
  const run = spawnSync(process.execPath, [stub, "wait", "--until-change"], { env: { ...process.env, STUB_SCRIPT: script }, timeout: 700 });
  assert.equal(run.error?.name === "Error" ? (run.error as NodeJS.ErrnoException).code : null, "ETIMEDOUT");
});

test("any other argv is refused with exit 3 and still logged", () => {
  const { run, log } = runStub([], ["unchanged"]);
  const r = run(["tail"]);
  assert.equal(r.status, 3);
  assert.deepEqual(lines(log).map((l) => l.argv.join(" ")), ["--protocol", "tail"]);
  assert.equal(run(["status"]).status, 3);
  assert.equal(run(["status", "--json", "--verbose"]).status, 3);
});

test("the stub's answers are byte-equal to the pinned CLI where the pinned CLI answers", { skip: !existsSync(pinned) && "pinned specstride CLI not installed" }, () => {
  const call = (bin: string, args: string[], cwd: string, env: Record<string, string> = {}) =>
    spawnSync(bin, args, { cwd, encoding: "utf8", env: { ...process.env, ...env } });
  const dir = scratch();
  const stubEnv = (steps: unknown[]) => {
    const script = join(scratch(), "s.json");
    writeFileSync(script, JSON.stringify({ steps }));
    return { STUB_SCRIPT: script };
  };
  const pick = (r: ReturnType<typeof call>) => ({ status: r.status, stdout: r.stdout, stderr: r.stderr });

  // no state
  assert.deepEqual(pick(call(stub, ["status", "--json"], dir, stubEnv(["no-state"]))), pick(call(pinned, ["status", "--json"], dir)));
  // control plane, no feature
  const withPlane = scratch();
  writeFileSync(join(withPlane, "marker"), "");
  spawnSync("mkdir", ["-p", join(withPlane, ".specstride")]);
  assert.deepEqual(pick(call(stub, ["status", "--json"], withPlane, stubEnv(["no-feature"]))), pick(call(pinned, ["status", "--json"], withPlane)));
  // wait usage: unknown argument and missing --until-change
  for (const args of [["wait", "--json"], ["wait"]]) {
    const expected = pick(call(pinned, args, dir));
    assert.equal(expected.status, 3);
    assert.deepEqual(pick(call(stub, args, dir, stubEnv(["unchanged"]))), expected, args.join(" "));
  }
  // --protocol
  assert.equal(call(stub, ["--protocol"], dir).stdout, call(pinned, ["--protocol"], dir).stdout);
});
