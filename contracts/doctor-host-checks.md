# Doctor host checks (F120-FR-016)

Feature 120. Date: 2026-11-06. Six checks, closed set owner 120 (`closed-sets.json`), run by `specstride-host-dsh doctor` — the doctor skill's own command (U-3 fallback, [research.md](research.md) R7). Each check is an object in the kit's `DoctorCheck` shape (`@specstride/contracts/ep/doctor`): `id`, `severityRule`, `lb`, `order`, `probe` (injected), `messageTemplate` (≤ 200 bytes), `fixHint`. Findings print as `<severity> <check> — <fix>`; exit codes come from the kit's `DOCTOR_EXITS` (annex G §G.4). Runner guarantees inherited from the kit: a check reads and never writes, makes no paid call, prints no secret value; a check that throws is a `fail` and the doctor exits 1; an unknown id in a filter exits 3.

## The checks, in order

| # | id | Observation (probe) | Severity rule | lb | Fix line |
|---|---|---|---|---|---|
| 1 | `host.cli-found` | is an executable `specstride` found via `SPECSTRIDE_BIN` or PATH (the shim's own two steps) | absent → `fail`; present → `ok` | **true** — the only launch check | the kit shim's `INSTALL_COMMAND`, version-inlined at build (F120-FR-011); printed, never run |
| 2 | `host.protocol-supported` | the CLI's `--protocol` integer (via the shim) | inside the manifest range → `ok`; mismatch → `fail`; unprobeable → `warn` | false | the kit builder's fix, verbatim (names the doctor; host-neutral) |
| 3 | `host.dsh-version` | `dsh --version` | inside `>=0.1.0-rc.8 <0.1.0` → `ok`; past it → `warn`; unretrievable → `warn` | false | upgrade or pin dsh to the tested release; nothing stops past the range (F120-FR-016) |
| 4 | `host.skills-installed` | the three directories in a root, unshadowed by a higher-rank root, at this package's version (frontmatter `metadata.version`) | all present, current, unshadowed → `ok`; stale or shadowed → `warn`; missing → `fail` | false | the install command for the missing/stale scope; the shadowing root named when one exists |
| 5 | `host.state-root-writable` | can a file be created under `$XDG_STATE_HOME/specstride/` in the current mode (probe file, then removed) | writable → `ok`; blocked → `warn` (the skills still work; `launch` will state it in one line, F120-FR-017); unverified → `warn` | false | exactly `DSH_PERMISSION_MODE=danger-full-access`, or a writable root that includes the state home **where the installed dsh supports one** (clause `unverified`); never an offer to move state into the working tree; this package never changes the mode |
| 6 | `host.permission-mode` | `DSH_PERMISSION_MODE` in force (verified fact, rc.8: default `workspace-write` with `ask` when unset) and whether an approval can be answered (headless = no approver — R4 F11; other surfaces follow the installed dsh) | `danger-full-access` → `ok`; headless → `warn` with the no-approver fact; `workspace-write` with `ask` → `info` | false | none required; the finding is what `specstride-run` states when `host.state-root-writable` warned (F120-FR-017) |

Severity closed set: `ok`, `info`, `warn`, `fail`; unknown severity → `warn` (EP-14).

## Composition notes (R7)

- Reused from the kit verbatim: `protocolSupportedCheck` only — its template and fix are host-neutral.
- Rebuilt in the kit's shape (fix lines are dsh requirements): `cli-found` (the kit builder's literal fix names `specstride@0.0.0` — a placeholder version of a package the engine does not publish, U-2; the dsh fix inlines the pinned release's version — an upstream note, not forked here), `state-root-writable` (the kit's fix is the 122 wording).
- New on dsh: `dsh-version`, `skills-installed`, `permission-mode` (the kit's `HOST_CHECK_IDS` are Claude-shaped: `host.plugin-version`, `host.host-hooks-loaded` — no dsh hook exists (F120-FR-014) — and `host.background-isolation` are not dsh checks).
- Facts read from the host-facts table: the `dsh-version` range, the permission-mode semantics, the roots and ranks. The command-roster collision fact is printed `unverified` until its settling check runs; no check claims a pass it cannot ground (Principle XVII).
- Registration: the kit's `registerHostChecksOf` targets an EP-14 registry, unreachable from a separately installed package while U-3 is unsettled; when U-3 lands, registration moves to the registry and the local runner is deleted, not feature-flagged.
- `--json` prints the findings as the EP-14 shape (F120-FR-014 allows the doctor `--json`).

## Mode matrix (the fixture matrix of the tests)

| Mode | approval answerable | state home | expected findings |
|---|---|---|---|
| `danger-full-access` | yes | writable | checks 1–4 per their probes; 5 `ok`; 6 `ok` |
| `workspace-write` + `ask` (default) | yes | blocked | 5 `warn` (fix = `DSH_PERMISSION_MODE=danger-full-access`); 6 `info` |
| `headless-no-approver` (headless profile) | no | blocked | 5 `warn`; 6 `warn`; `specstride-run` states in one line that an approval-needing launch fails closed |

The live probe of F120-FR-030 (person-started, paid) runs this doctor on a real launch and writes its results into the five host-facts rows it settles (detached survival past session end; teardown and the process group; sandbox writable roots; detached child inherits the sandbox; the model-free headless task).
