/**
 * T004 — the host-facts table (F120-FR-029).
 * Every row carries `pin`; every `unverified` row carries a settling check.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  dshHostFacts,
  dshHostFactOf,
  unverifiedDshHostFacts,
  DSH_VERSION_PIN,
  DSH_VERSION_RANGE,
} from "../../src/host-facts.ts";

test("every row carries the dsh pin", () => {
  assert.ok(dshHostFacts.length >= 8, "the table seeds at least the verified facts of R4/R13");
  for (const row of dshHostFacts) {
    assert.equal(row.pin, DSH_VERSION_PIN, `${row.id} must carry the pin`);
    assert.match(row.id, /^HF-\d+$/);
    assert.ok(row.fact.length > 0);
    assert.ok(row.source.length > 0);
  }
});

test("every unverified row carries a settling check; no verified row has one", () => {
  const unverified = unverifiedDshHostFacts();
  assert.ok(unverified.length >= 7, "seven unverified rows are recorded");
  const expected = [
    "HF-09", // detached survival past session end
    "HF-10", // teardown and the process group
    "HF-11", // sandbox writable roots
    "HF-12", // detached child inherits the sandbox
    "HF-13", // command-roster visibility
    "HF-14", // a model-free headless task
    "HF-15", // the dsh tool-restriction flag
  ];
  for (const id of expected) {
    const row = dshHostFactOf(id);
    assert.ok(row !== undefined, `${id} is recorded`);
    assert.equal(row.verifiedOn, "unverified");
    assert.ok(row.settlingCheck !== null && row.settlingCheck.length > 0);
  }
  for (const row of unverified) {
    assert.ok(row.settlingCheck !== null && row.settlingCheck.length > 0);
  }
  for (const row of dshHostFacts) {
    if (row.verifiedOn !== "unverified") {
      assert.equal(row.settlingCheck, null);
      assert.match(row.verifiedOn, /^\d{4}-\d{2}-\d{2}$/);
    }
  }
});

test("the verified facts of R4 and the facts file are present", () => {
  const ids = dshHostFacts.map((row) => row.id);
  for (const id of ids) {
    const row = dshHostFactOf(id)!;
    assert.ok(typeof row.fact === "string");
  }
  const facts = dshHostFacts.map((row) => row.fact).join("\n");
  assert.match(facts, /rank order/, "skill roots and ranks");
  assert.match(facts, /500 characters/, "catalog cap 500");
  assert.match(facts, /resident/, "resident cost");
  assert.match(facts, /--profile headless/, "profiles and headless semantics");
  assert.match(facts, /DSH_PERMISSION_MODE/, "permission-mode semantics");
  assert.match(facts, /owned by the calling session/, "jobs owned by the calling session");
  assert.match(facts, /no hook a consumer can configure/, "no configurable hook");
  assert.match(facts, /JSONL/, "session-log JSONL path");
});

test("the recorded dsh-version range is exported for host.dsh-version", () => {
  assert.equal(DSH_VERSION_RANGE, ">=0.1.0-rc.8 <0.1.0");
  assert.equal(DSH_VERSION_PIN, "0.1.0-rc.8");
});
