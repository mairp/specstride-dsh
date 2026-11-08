# @specstride/host-dsh — the Specstride host package for dsh

This package carries Specstride onto the **dsh** agent host as three skill
directories, a shim, an installer, a doctor and an eval driver. It renders the
skills from the pinned `@specstride/host-kit` (the four engine tarballs under
`vendor/core/`, verified against `core-pin.json` — this repository pins the
engine, it never builds it), inserts the dsh frontmatter and runtime notes,
and ships a shim that is the only channel between a skill and the Specstride
CLI.

**Also in this repository:** `packages/dsh-kanban/` — `@specstride/dsh-kanban`,
the Kanban tab plugin for the dsh web UI (feature 121,
`specs/121-dsh-kanban`), which depends on this package's shim and is **not**
part of the 120 install: 120 ships without it
(see [`packages/dsh-kanban/README.md`](packages/dsh-kanban/README.md)).

**Platform note:** Linux is verified by this repository's gate. macOS is
`unverified` until a runner passes the oracle there (constitution XVII; the
Principle X pins name the tested releases).

## Install

From this repository root (Node ≥ 22, `dsh` 0.1.0-rc.8 on PATH):

```sh
npm install        # resolves the pinned engine tarballs; no install script, nothing compiles
npm run build      # renders skills/ + bin/, runs every build gate
npm test           # unit + contract tests; no test calls a model
npm run conformance
npm install -g . vendor/core/specstride-0.1.0.tgz   # puts specstride-host-dsh and the pinned specstride CLI on PATH
```

Nothing is on npm yet, so the CLI comes from the tarball this repository pins.
Then, in the consumer repository:

```sh
specstride-host-dsh install --project   # three skill dirs into .dsh/skills/ + the install record
specstride-host-dsh install --project   # → "already installed, unchanged"
specstride-host-dsh uninstall --project
specstride-host-dsh doctor              # six findings, one line each
```

Scopes: `--project` installs into `<projectRoot>/.dsh/skills` (record next to
the skills); `--shared` into `$HOME/.agents/skills`; the default (user) scope
into `$DSH_HOME/skills`. The installer installs, reports and removes — it
never overwrites foreign content and never updates a file whose hash no longer
matches the record (that file is the consumer's text now).
The doctor's `host.skills-installed` looks in every root dsh scans, in rank
order (`<projectRoot>/.dsh/skills`, `<projectRoot>/.agents/skills`,
`$DSH_HOME/skills`, `~/.agents/skills`; the project root is `PROJECT_ROOT`, else
the working directory), so an install in any scope satisfies it.

## Doctor

`specstride-host-dsh doctor` prints six findings in the grammar
`<severity> <check> — <fix>`, one line each:

`host.cli-found`, `host.protocol-supported`, `host.dsh-version`,
`host.skills-installed`, `host.state-root-writable`, `host.permission-mode`.
Only a missing CLI blocks a launch. On a machine with no CLI it prints the
install command (`npm install -g specstride@<version>`) and **never runs it** —
the package installs and updates the CLI by itself never.

## Walkthrough: dry-run, then a supervised run

Say, in a dsh session with the skills installed:

1. **Dry run** — "run the specstride-run skill in dry-run on <the change>".
   The skill captures your comment verbatim, checks the CLI through the shim,
   derives, judges the batches, validates — and **launches nothing**. Expected:
   a short plan and a validation verdict, every CLI line relayed verbatim.
2. **Run** — "run the specstride-run skill on <the change>". At the launch step
   the skill calls the CLI **in the foreground** (`run_in_background: true` is
   forbidden for it). Exactly as the CLI prints: `started` → supervise the run
   that started; `attached` → supervise the run that lives; `refused` → print
   the refusal and do not retry.
3. **Supervision** — one blocking `wait --until-change` per cycle; an unchanged
   cycle prints nothing; the digest is relayed when the CLI gives it, as the
   final line, verbatim.
4. **Reverse** — "run the specstride-reverse skill on <the sources>". Same
   shim, same budgets; it ends at the plan and inventory — it never launches
   or writes.
5. **Doctor skill** — invoke `specstride-doctor`: it relays the CLI's own
   doctor (structured reads through `--json` only), then runs
   `specstride-host-dsh doctor` and relays each finding in the line grammar.

Explicit mode beats comment prose; a comment that refuses a launch ("do not
run", "dry run only") beats an invitation and gives `dry-run`. A first refusal
from the CLI is printed with its `[SPECSTRIDE-REFUSE]` line and stops the
skill — no retry.

## The host's own state (what this package writes, and where)

| Path | What it is |
|---|---|
| `<project>/.dsh/skills/` (or the scope root) | the three skill directories — state of the consumer's repository only through the documented install |
| `<install root>/.specstride-host-dsh-install.json` | the install record: what was installed, per-file sha256 |
| `$DSH_HOME/specstride-host/markers/audience-notice` | the audience-notice marker — shown once per consumer. State of the HOST with no logical name in annex B §B.5, reported here the way feature 113 reported Claude's two markers |
| `$DSH_HOME/sessions/session.jsonl` | written by dsh itself; the eval driver reads it to grade, nothing else reads it |

The product's own state stays in the engine's roots under
`$XDG_STATE_HOME/specstride/`. No skill reads or writes it: a skill names every
artifact by the logical name the CLI printed, never by a path.

## Troubleshooting

| Symptom | Meaning / fix |
|---|---|
| `[SPECSTRIDE-REFUSE] action=protocol reason=protocol-mismatch found=N supported=1 check=--protocol fix="specstride doctor"`, exit 4 | The CLI's protocol ≠ 1: run the doctor; upgrade or pin the engine — never edit the shim |
| One line naming the doctor and `npm install -g specstride@<v>`, exit 127 | No CLI found via `SPECSTRIDE_BIN` or PATH: install the printed command, or set `SPECSTRIDE_BIN`; there is no third place |
| `install` refuses naming a directory | Foreign or changed content in the target root: remove it by hand or accept the recorded state; the installer never overwrites |
| `uninstall` keeps a file | Its hash no longer matches the record — it is the consumer's text now |
| The skill does not appear in dsh | Wrong root (ranks: `.dsh/skills` 100 > `$DSH_HOME/skills` 400 > `~/.agents/skills` 500) or malformed frontmatter — suspect the root first |
| `warn host.dsh-version` | dsh past `>=0.1.0-rc.8 <0.1.0`: pin or upgrade; nothing stops |
| `fail host.skills-installed` | The skills are missing, stale, or shadowed by a higher-rank root at another version: run `specstride-host-dsh install` again in the right scope |
| `npm run build` fails naming an artifact | A gate found a real violation (budget, line attribution, engine copy, reference): fix the source named; the build never warns and continues |

## Paid lane (a person starts these — never the build)

- The trigger suite and the release gate (`specstride-host-dsh eval`).
- The live probe of F120-FR-030 (`evals/live-probe.md`): one person-started
  paid run whose results are written back into the five `unverified` host-facts
  rows it settles.

No per-change gate (install, build, test, conformance) calls a model or any
paid or external API.
