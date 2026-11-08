/**
 * T003 — the dsh render profile (F120-FR-001, F120-FR-026).
 * Budget arithmetic at 2.8 bytes/token; unknown logical id refuses; spellings
 * match the closed set.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertBudgetTables,
  bytesForTokens,
  byteBudgetOf,
  renderEntry,
  UnknownLogicalIdError,
} from "@specstride/host-kit";
import {
  dshProfile,
  dshSpellings,
  dshTokenBudgets,
  dshPrintedByteBudgets,
  dshBudgetTokensOf,
  DSH_BUDGET_REQUIREMENT,
} from "../../src/profile.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("profile carries the dsh figures", () => {
  assert.equal(dshProfile.bytesPerToken, 2.8);
  assert.equal(dshProfile.maxBodyLines, 500);
  assert.equal(dshProfile.skillFile, "SKILL.md");
  assert.equal(dshProfile.skillsDirectory, "skills");
  assert.equal(dshProfile.descriptionCap, 500);
  assert.equal(dshProfile.budgetRequirement, "F120-FR-026");
  assert.equal(DSH_BUDGET_REQUIREMENT, dshProfile.budgetRequirement);
});

test("budget arithmetic holds at 2.8 bytes/token (F120-FR-026)", () => {
  assertBudgetTables(dshProfile);
  assert.equal(dshTokenBudgets["specstride-run"], 8_000);
  assert.equal(dshTokenBudgets["specstride-reverse"], 7_000);
  assert.equal(dshTokenBudgets.doctor, 1_500);
  assert.equal(dshTokenBudgets["supervision-cycle"], 150);
  assert.equal(dshTokenBudgets["supervision-run"], 3_000);
  assert.equal(bytesForTokens(8_000, 2.8), 22_400);
  assert.equal(dshPrintedByteBudgets["specstride-run"], 22_400);
  assert.equal(dshPrintedByteBudgets["specstride-reverse"], 19_600);
  assert.equal(dshPrintedByteBudgets.doctor, 4_200);
  assert.equal(dshPrintedByteBudgets["supervision-cycle"], 420);
  assert.equal(dshPrintedByteBudgets["supervision-run"], 8_400);
  for (const [key, tokens] of Object.entries(dshTokenBudgets)) {
    assert.equal(
      dshPrintedByteBudgets[key],
      bytesForTokens(tokens, dshProfile.bytesPerToken),
      `printed figure for ${key} must equal tokens × rate`,
    );
    assert.equal(
      byteBudgetOf(key, dshProfile),
      dshPrintedByteBudgets[key],
      `the kit's budget for ${key} must be the profile's`,
    );
  }
});

test("an unknown logical id refuses (F120-FR-001)", () => {
  assert.throws(() => dshBudgetTokensOf("specstride-doctor"), UnknownLogicalIdError);
  assert.throws(() => renderEntry("specstride-doctor", dshProfile), UnknownLogicalIdError);
  assert.throws(
    () => renderEntry("no-such-id", dshProfile),
    (error: unknown) =>
      error instanceof UnknownLogicalIdError &&
      /is no logical id/.test(error.message),
  );
});

test("spellings match the closed set line-for-line", () => {
  const closed = JSON.parse(
    readFileSync(join(ROOT, "contracts/closed-sets.json"), "utf8"),
  ) as {
    proposedByFeature: { id: string; members: { logicalId: string; spelling: string }[] }[];
  };
  const row = closed.proposedByFeature.find((r) => r.id === "dsh-skill-spellings")!;
  for (const member of row.members) {
    assert.equal(dshSpellings[member.logicalId], member.spelling);
  }
  assert.deepEqual(Object.keys(dshSpellings).sort(), ["doctor", "specstride-reverse", "specstride-run"]);
});

test("the doctor's logical id is `doctor`, spelled specstride-doctor", () => {
  assert.equal(renderEntry("doctor", dshProfile), "specstride-doctor");
  assert.equal(renderEntry("specstride-run", dshProfile), "specstride-run");
  assert.equal(renderEntry("specstride-reverse", dshProfile), "specstride-reverse");
});
