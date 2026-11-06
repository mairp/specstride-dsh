# Live probe — `live-probe-dsh` (F120-FR-030, PT-120-030)

A **person** starts and runs this probe. It is NEVER run by the build, by a
test, or by any per-change gate (F120-FR-024): it starts real `dsh` sessions
and, unless dsh allows a model-free headless task, it is a **paid** task under
the rules of F120-FR-024. It is recorded in `src/evals/paid-lane.ts` as the
paid task name `live-probe-dsh`.

## What it settles

The five `unverified` rows of `src/host-facts.ts` (pin `dsh 0.1.0-rc.8`):

| Row | Fact |
|---|---|
| HF-09 | Detached survival past session end |
| HF-10 | Teardown and the process group |
| HF-11 | Sandbox writable roots |
| HF-12 | Whether a detached child inherits the sandbox |
| HF-14 | A model-free headless task |

The rows stayed `verifiedOn: "unverified"` until a person ran this probe and
wrote the results back (see "Write-back" below).

## Settled — 2026-11-06

The probe was run on 2026-11-06 (paid lane `live-probe-dsh`, F120-FR-024:
probe 1 proved dsh rc.8 allows no model-free headless task). Transcripts:
`evals/probe-results/2026-11-06-hf09-hf10-detached-survival.txt`,
`2026-11-06-hf11-hf12-sandbox.txt`, `2026-11-06-hf14-model-free-headless.txt`,
and — the probe 2 rerun that goes **through the skill's launch step** —
`evals/probe-results/2026-11-06-hf09-skill-launch-step.txt`.

The rerun (hermetic scratch workspace `/tmp/probe120`, project-scope skills
installed by `specstride-host-dsh install --project`, stub CLI + the shipped
shim on PATH, `XDG_STATE_HOME=/tmp/probe120-state`): a `dsh --profile headless`
session invoked the skill `specstride-run` (skill `tool/call` naming it in the
session log), reached the skill's launch step and performed it as the skill
prescribes — a **foreground** shell call of the shim,
`specstride-dsh launch --comment "probe-120"` (no `run_in_background`), which
forwarded through the shim to the CLI; the CLI started the detached run
(`started run=probe-120 pid=352680`) and wrote its state line under the state
home. The session then ENDED (exit 0); from a fresh shell the run was still
alive (`ps`: PPID 1, own PGID/SID — setsid) and the state line
`run-id=probe-120 pid=352680 started=…` / `args: --comment probe-120` was
present at `/tmp/probe120-state/specstride/run-state.txt`.

All five rows were written back in `src/host-facts.ts` (`verifiedOn:
"2026-11-06"`, `settlingCheck: null`); HF-13 and HF-15 remain unverified.

## Preparation

1. Work on a Linux machine with `dsh` 0.1.0-rc.8 installed (`dsh --version`).
2. Build and install the host package: `npm run build && npm run install -- --project <a scratch project>`.
3. Run `specstride-host-dsh doctor` first; record its six findings. Do not
   proceed while a launch-blocking finding (missing CLI) stands.
4. Set `DSH_PERMISSION_MODE=workspace-write` for the main pass; note every
   deviation.

## Probe 1 — model-free headless task (HF-14; settles whether the rest is paid)

1. From a shell (not a dsh session), run:
   `dsh --profile headless "print the literal text probe-ok and call no tool"` once.
2. Observe whether a model is invoked (usage line in the session output, or a
   billed request in the provider log).
3. **If dsh refuses a no-tool task or a model is always invoked**, the probe
   is a PAID task: stop after each step below, count the calls, and record the
   spend in the write-back.

## Probe 2 — detached survival past session end (HF-09)

Run form actually used on 2026-11-06 (recorded, not silent): the dsh session is
a `dsh --profile headless` task whose prompt invokes `/specstride-run` and
performs ONLY the launch step through the shim; "end the session" is the
headless process exiting after its task. An interactive session follows the
identical steps.

1. Open a dsh session in the scratch project with the skills installed.
2. Invoke `/specstride-run` with a comment that starts a run against the stub
   `specstride` CLI on the probe PATH — a stub that spawns a detached
   `setsid` sleeper (`setsid sleep 300`) and prints its own PID.
3. End the dsh session (exit, not kill).
4. From a FRESH shell: check the sleeper's PID is still alive
   (`ps -p <pid>`), and check the stub's state file was written under the
   state home.
5. Record: alive yes/no; state written yes/no.

## Probe 3 — teardown and the process group (HF-10)

1. Repeat probe 2 but note the process group of the detached child
   (`ps -o pid,pgid,cmd -p <pid>`).
2. End the dsh session while the sleeper lives.
3. Immediately re-check the PID. Record: killed yes/no; whether the child's
   PGID differs from the session process's PGID.

## Probe 4 — sandbox writable roots (HF-11)

1. In a dsh session under `workspace-write`, attempt a write OUTSIDE the
   workspace (e.g. under the state home) with the session's own tools.
2. Repeat under headless with no approver, and under `danger-full-access`.
3. Record the writable roots observed per mode, and whether
   `danger-full-access` admits a writable root that includes the state home
   (the `stateRootWritable: true` arm of `describe`).

## Probe 5 — detached child inherits the sandbox (HF-12)

1. From a dsh session in `workspace-write`, start the stub run of probe 2 whose
   detached child attempts a write OUTSIDE the workspace.
2. Observe whether the write lands. Record: escaped yes/no.

## Write-back

For each settled row, edit `src/host-facts.ts`:

- set `verifiedOn` to the probe date (ISO `YYYY-MM-DD`);
- keep `pin: DSH_VERSION_PIN`;
- replace `settlingCheck` with `null`;
- if the fact is REFUTED, keep the row but change the fact text to what was
  observed and re-derive every requirement that rested on it (F120-FR-013,
  F120-FR-017) — never delete the row.

Record the probe transcript (commands + outputs, one file per probe) next to
this runbook as `evals/probe-results/<date>-<probe>.txt`, and note the run in
`.specstride/features/120-host-dsh/PROGRESS.md`. The build calls no probe and
reads no probe result file.
