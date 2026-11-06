/**
 * T032 — the HostPort object of `src/port.ts` (F120-FR-001, F120-FR-015;
 * contracts/host-package.md — G-A). The port is `{host: "dsh",
 * port: "specstride.host/1", protocol: 1}` with `describe`, `renderSkill`,
 * `renderEntry` (entry only for the two model-invocable skills) and
 * `evalDriver.run`; `renderStatusHooks` is DECLARED ABSENT.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { HOST_SKILL_IDS } from "@specstride/host-kit";
import { dshHostPort, capabilityAbsentLine, CAPABILITY_ABSENT, DSH_ENTRY_IDS } from "../../src/port.ts";
import { describeOfDsh } from "../../src/describe.ts";

const port = dshHostPort();

test("the port names the host, the EP-01 port id and the protocol 1", () => {
  assert.equal(port.host, "dsh");
  assert.equal(port.port, "specstride.host/1");
  assert.equal(port.protocol, 1);
});

test("describe is src/describe.ts's — the six capabilities, no engine call", () => {
  assert.deepEqual(port.describe(), describeOfDsh());
  assert.equal(port.describe().model, true);
  assert.equal(port.describe().stateRootWritable, false);
  assert.equal(port.describe().hooks, null);
  assert.equal(port.describe().statusSurface, null);
});

test("renderSkill is the src/skills.ts binding over the src/profile.ts profile", () => {
  const artifact = port.renderSkill({
    logicalId: "specstride-run",
    body: "irrelevant for the binding — the binding composes the dsh source",
    references: [],
    budget: 8_000,
  });
  assert.equal(artifact.path, "skills/specstride-run/SKILL.md");
  assert.match(artifact.content, /dsh runtime notes/);
  assert.throws(
    () => port.renderSkill({ logicalId: "no-such-id", body: "x", references: [], budget: 1 }),
    /Unknown logical id|no-such-id/,
  );
});

test("renderEntry exists only for the two model-invocable skills", () => {
  assert.deepEqual([...DSH_ENTRY_IDS], [...HOST_SKILL_IDS]);
  assert.equal(port.renderEntry("specstride-run"), "specstride-run");
  assert.equal(port.renderEntry("specstride-reverse"), "specstride-reverse");
  // The doctor has no entry point: capability-absent, with the port grammar.
  assert.throws(() => port.renderEntry("doctor"), (error: Error) =>
    error.message.startsWith(capabilityAbsentLine("renderEntry")));
  assert.throws(
    () => port.renderEntry("no-such-id"),
    /Unknown logical id|no-such-id/,
  );
});

test("renderStatusHooks is declared absent — calling it is capability-absent (EP-01)", () => {
  assert.equal(typeof (port as { renderStatusHooks?: unknown }).renderStatusHooks, "undefined");
  assert.equal(CAPABILITY_ABSENT, "capability-absent");
  assert.match(
    capabilityAbsentLine("renderStatusHooks"),
    /^\[SPECSTRIDE-REFUSE\] action=renderStatusHooks reason=capability-absent host=dsh port=specstride\.host\/1$/,
  );
});

test("evalDriver.run grades the hermetic headless session of src/evals/driver.ts — stub agents on oracle fixtures, no paid call", async () => {
  // A stub `dsh` on the case PATH writes a recorded session log; the port
  // grades from the session log only. Zero paid call anywhere.
  const { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { hermeticEnvironment } = await import("../../src/evals/driver.ts");
  const base = mkdtempSync(join(tmpdir(), "specstride-dsh-port-test-"));
  const stubDshBin = join(base, "bin");
  mkdirSync(stubDshBin);
  const stubDsh = join(stubDshBin, "dsh");
  writeFileSync(
    stubDsh,
    "#!/bin/sh\n" +
      // Write a session log naming the skill; the grader reads the log only.
      'mkdir -p "$DSH_HOME/sessions"\n' +
      'printf \'%s\\n\' \'{"type":"tool/call","tool":"skill","input":{"name":"specstride-run"}}\' \'{"type":"session-end","exitCode":0}\' > "$DSH_HOME/sessions/session.jsonl"\n' +
      "exit 0\n",
    { encoding: "utf8" },
  );
  chmodSync(stubDsh, 0o755);
  try {
    const stubPort = dshHostPort({
      environmentFor: (prompt: string) => {
        void prompt;
        const environment = hermeticEnvironment();
        const env = { ...environment.env, PATH: `${stubDshBin}:${environment.env.PATH}` };
        return { ...environment, env };
      },
    });
    const results = await stubPort.evalDriver.run([
      { id: "oracle-1", prompt: "run specstride-run on the comment 'x'", expected: "specstride-run" },
      { id: "oracle-2", prompt: "load the other skill", expected: "specstride-reverse" },
    ]);
    assert.equal(results.length, 2);
    assert.equal(results[0]!.matched, true);
    assert.equal(results[1]!.matched, false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
