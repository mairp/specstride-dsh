/**
 * The capability declaration (T009, F120-FR-015; contracts/host-package.md —
 * G-A: after T004, the values are read from `src/host-facts.ts`, never
 * restated).
 *
 * The six capability declarations of annex H §H.1 go through the kit's
 * `capabilityDeclaration` / `describeOf`, which read the `Values` column and
 * the declared fallback from `@specstride/contracts` — never spelled here.
 * `renderStatusHooks` is DECLARED ABSENT (the port's optional operation):
 * calling it is `capability-absent` (EP-01). Each absent capability uses the
 * `host-capabilities.json` fallback verbatim (the kit's `fallbackOf`);
 * an unknown capability is ignored (the kit's `unknownCapabilityIsIgnored`).
 * `describe` itself never calls the engine — every input below is data.
 */
import {
  capabilityDeclaration,
  describeOf,
  type CapabilityDeclaration,
  type CapabilityRendering,
  type HostDescription,
} from "@specstride/host-kit";
import { dshHostFactPin, DSH_VERSION_PIN } from "./host-facts.ts";

/**
 * The `stateRootWritable` fact of F120-FR-015, read from the host-facts
 * table's mode semantics (HF-05, HF-11): `false` under `workspace-write` and
 * under headless with no approver, `true` under `danger-full-access`,
 * `"unverified"` for any other mode.
 */
export function dshStateRootWritableOf(
  mode: string,
): boolean | "unverified" {
  if (mode === "workspace-write") return false;
  if (mode === "danger-full-access") return true;
  if (mode === "headless") return false;
  return "unverified";
}

/** The host-facts row each declaration rests on. */
const HOOKS_FACT = "HF-07";
const MODE_FACT = "HF-05";

function declare(input: {
  capability: CapabilityDeclaration["capability"];
  present: boolean;
  value: string | readonly string[] | null;
  absentBecause: string | null;
  hostFact: string;
}): CapabilityDeclaration {
  return capabilityDeclaration({
    capability: input.capability,
    present: input.present,
    value: input.value,
    absentBecause: input.absentBecause,
    requirement: "F120-FR-015",
    hostFact: input.hostFact,
    pin: dshHostFactPin(input.hostFact),
  });
}

/**
 * The six declarations of annex H §H.1 for dsh, in the order of the annex —
 * plus nothing: an unknown capability has no row here, and one a caller
 * asks for anyway is ignored by the kit.
 */
export function dshCapabilityDeclarations(
  mode: string = "workspace-write",
): readonly CapabilityDeclaration[] {
  const writable = dshStateRootWritableOf(mode);
  if (writable === "unverified") {
    // An unverified mode cannot be declared present or absent: refuse the
    // build rather than claim a capture that was not run (Principle XVII).
    throw new Error(
      `F120-FR-015: the permission mode "${mode}" is unverified on dsh ${DSH_VERSION_PIN} — the host-facts table carries no verified value for it`,
    );
  }
  return Object.freeze([
    declare({
      capability: "hooks",
      present: false,
      value: null,
      absentBecause:
        "dsh offers no hook a consumer can configure; alerts come from the engine's status and digest",
      hostFact: HOOKS_FACT,
    }),
    declare({
      capability: "statusSurface",
      present: false,
      value: null,
      absentBecause: "there is no dsh status surface; status is the CLI's own lines",
      hostFact: HOOKS_FACT,
    }),
    declare({
      capability: "background",
      present: true,
      value:
        "session-scoped dsh jobs (`bash run_in_background`); not used for the run",
      absentBecause: null,
      hostFact: "HF-06",
    }),
    declare({
      capability: "evals",
      present: true,
      value: "session-log driver",
      absentBecause: null,
      hostFact: "HF-08",
    }),
    declare({
      capability: "model",
      present: true,
      value: "true",
      absentBecause: null,
      hostFact: MODE_FACT,
    }),
    declare({
      capability: "stateRootWritable",
      present: writable === true,
      value: writable === true ? "true" : "false",
      absentBecause:
        writable === false
          ? "the default sandbox `workspace-write` (and headless with no approver) does not permit writing the state home; under `danger-full-access` it is writable"
          : null,
      hostFact: MODE_FACT,
    }),
  ]);
}

/** The rendering data of contracts/host-package.md for dsh. */
export const dshCapabilityRendering: CapabilityRendering = Object.freeze({
  skillNamingRule:
    "the spelling of the logical id, kebab-case, is the skill's whole name and its directory name (dsh has no colon namespace)",
  descriptionCap: 500,
  packagingForm: "skill directories in a dsh skill root",
});

/** `describe` of EP-01 for dsh. It never calls the engine: pure data in, data out. */
export function describeOfDsh(mode: string = "workspace-write"): HostDescription {
  return describeOf(dshCapabilityDeclarations(mode), dshCapabilityRendering);
}

/** The host port of EP-01 as this package offers it — WITHOUT `renderStatusHooks`. */
export const RENDER_STATUS_HOOKS_IS_ABSENT = true;

/**
 * The port object a conformance target takes. `renderStatusHooks` is
 * deliberately not present: the property is undefined, so calling it is the
 * port's `capability-absent` path (EP-01), never an artifact list.
 */
export function dshHostPortFacts(): {
  readonly host: "dsh";
  readonly port: "specstride.host/1";
  readonly description: HostDescription;
} {
  return Object.freeze({
    host: "dsh" as const,
    port: "specstride.host/1" as const,
    description: describeOfDsh(),
  });
}
