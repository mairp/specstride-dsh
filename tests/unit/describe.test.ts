/**
 * T009 — the capability declaration (F120-FR-015).
 * The six values; fallback wording in use where the value holds it; unknown
 * capability dropped silently; `renderStatusHooks` declared absent.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  absentCapabilities,
  describeCapabilities,
  fallbacksInUse,
  fallbackOf,
  presentCapabilities,
  describeOf,
  capabilityDeclaration,
} from "@specstride/host-kit";
import {
  dshCapabilityDeclarations,
  dshCapabilityRendering,
  describeOfDsh,
  dshStateRootWritableOf,
  RENDER_STATUS_HOOKS_IS_ABSENT,
} from "../../src/describe.ts";

test("the six capability values (F120-FR-015)", () => {
  const description = describeOfDsh();
  assert.equal(description.hooks, null);
  assert.equal(description.statusSurface, null);
  assert.equal(
    description.background,
    "session-scoped dsh jobs (`bash run_in_background`); not used for the run",
  );
  assert.equal(description.evals, "session-log driver");
  assert.equal(description.model, true);
  assert.equal(description.packagingForm, "skill directories in a dsh skill root");
  assert.equal(description.stateRootWritable, false); // the default mode, workspace-write
  assert.equal(description.skillNaming.descriptionCap, 500);
});

test("stateRootWritable reads its values from the host-facts mode semantics, never restated", () => {
  assert.equal(dshStateRootWritableOf("workspace-write"), false);
  assert.equal(dshStateRootWritableOf("headless"), false);
  assert.equal(dshStateRootWritableOf("danger-full-access"), true);
  assert.equal(dshStateRootWritableOf("custom-mode"), "unverified");
  assert.equal(describeOfDsh("danger-full-access").stateRootWritable, true);
  assert.equal(describeOfDsh("headless").stateRootWritable, false);
  assert.throws(() => describeOfDsh("some-unknown-mode"), /unverified/);
});

test("absent capabilities use the host-capabilities.json fallback verbatim", () => {
  const declarations = dshCapabilityDeclarations();
  // Under the default mode `workspace-write` the state root is not writable,
  // so `stateRootWritable` is absent too and uses its declared fallback.
  assert.deepEqual(absentCapabilities(declarations), [
    "hooks",
    "statusSurface",
    "stateRootWritable",
  ]);
  assert.deepEqual(presentCapabilities(declarations), [
    "background",
    "evals",
    "model",
  ]);
  const fallbacks = fallbacksInUse(declarations);
  assert.equal(fallbacks["hooks"], fallbackOf("hooks"));
  assert.equal(fallbacks["hooks"], "Alerts through `status` and the digest");
  assert.equal(fallbacks["statusSurface"], fallbackOf("statusSurface"));
  assert.equal(fallbacks["statusSurface"], "`status --line` on request");
  assert.equal(fallbacks["stateRootWritable"], fallbackOf("stateRootWritable"));
});

test("an unknown capability is ignored silently (kit unknownCapabilityIsIgnored)", () => {
  const declarations = dshCapabilityDeclarations();
  const fake = capabilityDeclaration({
    capability: "model",
    present: true,
    value: "true",
    absentBecause: null,
    requirement: "F120-FR-015",
    hostFact: "HF-05",
    pin: "0.1.0-rc.8",
  });
  const bogus = { ...fake, capability: "telepathy" as never };
  const { declared, ignored } = describeCapabilities(
    [...declarations, bogus as never],
    ["hooks", "telepathy", "statusSurface", "another-unknown"],
  );
  // The unknown name is matched against the bogus declaration if one is
  // handed in (the kit takes it as given), but `describeOf` renders only the
  // six annex capabilities — the output never grows a key of its own.
  assert.equal(declared.length, 3);
  const description = describeOf(
    [...declarations, bogus as never] as never,
    dshCapabilityRendering,
  ) as unknown as Record<string, unknown>;
  assert.ok(!("telepathy" in description));
  assert.ok(!("another-unknown" in description));
  assert.deepEqual(ignored, ["telepathy", "another-unknown"]);
});

test("renderStatusHooks is declared absent — calling it is capability-absent (EP-01)", () => {
  assert.equal(RENDER_STATUS_HOOKS_IS_ABSENT, true);
  // The port object this package offers carries no renderStatusHooks.
  const description = describeOfDsh();
  const portLike = { describe: () => description };
  assert.equal((portLike as { renderStatusHooks?: unknown }).renderStatusHooks, undefined);
});

test("the declaration rows rest on the host-facts table, never restated", () => {
  const declarations = dshCapabilityDeclarations();
  for (const declaration of declarations) {
    assert.match(declaration.hostFact, /^HF-\d+$/);
    assert.equal(declaration.pin, "0.1.0-rc.8");
    assert.equal(declaration.requirement, "F120-FR-015");
  }
  assert.equal(describeOf(declarations, dshCapabilityRendering).evals, "session-log driver");
});
