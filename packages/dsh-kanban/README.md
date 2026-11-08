# @specstride/dsh-kanban — the Kanban tab for the dsh web UI

Feature 121 (`specs/121-dsh-kanban`). One dsh plugin package with two halves:

- a **client half** (`lib/client.js`, one `dsh.client` bundle) that registers
  a **Kanban** tab in the `conversation.view` ring — `id: "kanban"`,
  `order: 20`, after Chat (`0`) and Trajectory (`10`) — and renders the
  engine's `RunView` (`specstride.view/1`) as the engine's eight lanes
  (`queued`, `proposing`, `verifying`, `reviewing`, `approved`, `blocked`,
  `paused`, `failed`), attention items, budget rows and conditions. The board
  derives no lane, attention item, level or condition of its own; it renders
  the view as the engine gave it, marks its own staleness separately, styles
  only with the host's `--dsw-*` alias tokens, and encodes every state
  redundantly as glyph + label + grayscale (never colour alone).
- a **server half** (`lib/server/`, mounted through the `dsh.bundle` patch
  `cordis.patch.yml`) that registers exactly one read-only, exact, GET route
  `/specstride/view` on dsh's web server and reaches the engine only through
  the shim of feature 120 (`@specstride/host-dsh`), running only
  `specstride status --json` and `specstride wait --until-change` in the
  session's workspace. It fails open: a broken server half never stops dsh
  from booting, and the tab then says so in one line naming
  `/specstride-doctor`.

## Install and removal

Node ≥ 22; dsh `0.1.0-rc.8` on PATH; feature 120 built first. Nothing is on a
registry, so pack first and install the tarballs:

```sh
npm pack                                   # in the repository root: the 120 host package
npm pack                                   # in packages/dsh-kanban/
DSH_HOME=$(mktemp -d) dsh plugin --profile web add \
  /abs/specstride-host-dsh-<v>.tgz /abs/specstride-dsh-kanban-<v>.tgz --save-exact
```

Removal:

```sh
DSH_HOME=<same> dsh plugin --profile web remove @specstride/dsh-kanban
```

The web profile boots without the plugin; dsh and every skill of 120 are
unaffected (120 ships without it). `specstride-host-dsh doctor` reports the
plugin as check `host.kanban-plugin`: `info` when not installed, `warn` when
the profile holds a range spec instead of an exact pin, `ok` when exact, with
`server half unknown` unless the server half's own start line was seen (dsh
rc.8 exposes no per-profile log surface to read — it is never assumed).

Tests install only into a temporary `DSH_HOME`, never into a real one.

## The route contract (`/specstride/view`)

- One exact route, GET only, registered only when the web server's `host` is
  `127.0.0.1`. Under `0.0.0.0` the half registers nothing and logs one line
  (`route not registered: web server host is 0.0.0.0`).
- Every request carries a view token — minted per index response by the
  server half's index tap into `<meta name="specstride-view-token">` — bound
  on first use to one run id; a request without it, with a dead token, or
  with a token of another run is refused before any CLI call (`403`
  `forbidden`, `409` `run-changed`). A run change voids the token and the
  client refetches the index for a new one.
- Answers (JSON): `view`, `unchanged`, `no-run`, `refused-schema`,
  `unavailable`, `run-changed`, `forbidden`, `method-not-allowed`,
  `bad-request`. The client resolves everything it cannot read into the one
  unavailable line naming `/specstride-doctor`.
- Exactly two CLI verbs, both read-only, both with their own time limit and
  no process left behind; the half writes no file and holds no state but the
  newest view per open page.
- The workspace is resolved server-side from the conversation's session
  (`ctx.sessions.get(id)?.header.cwd`, else the persisted headers) and the
  CLI runs with that directory as its working directory; no workspace means
  `no-run` with zero CLI calls.

## Threat answers (engine roadmap row 121-kanban-ui, annex X §X.9)

| Threat | Answer here |
|---|---|
| T-38 — a viewer that reads more than the read model | Two read verbs only; no file read beyond the session's cwd (F121-FR-018) |
| T-39 — a viewer that writes engine state | GET only, one exact route, no upgrade/fallback route, no verb that writes (F121-FR-015) |
| T-40 — a viewer reachable from the network | The route exists only on a `127.0.0.1` web server (F121-FR-016) |
| T-41 — a request for another run | One token per page load, bound to one run id (F121-FR-017) |
| T-42 — a stale view taken as current | The engine's `dead`/`stale`/`launch-abandoned` banner plus the client's own "not updated since …" staleness (F121-FR-010) |
| Markup injection through run text | Every string is inserted as text; the renderer has no markup sink (F121-FR-012) |

## Open upstream rows (this repository → specstride-core)

- **U-7** (recorded, open in core's roadmap): the dsh tab renderer lives here;
  the harness-neutral renderers stay with the engine.
- **U-8** (open): the pinned CLI 0.1.0 exits 70 for `status --json` on a
  workspace with state (`VerbNotMountedError`). Every automated test uses a
  stub CLI; only the live probe below needs the real verb.
- **U-9** (open): the engine's golden views are not in any pinned package.
  `packages/dsh-kanban/scripts/parity-goldens.ts` is wired to run the parity
  of T012 over a directory of `specstride.view/1` files — a person runs it on
  the engine's goldens once U-9 ships them; nothing here fetches or copies
  them.

## Live-probe runbook (a person; no model call; blocked on U-8)

Purpose: settle **HF-18** (which field of a `conversation.view` registration
carries the component, and `[data-kanban]` in the served page) and the live
theme half of **F121-SC-002** (the board follows the host's light/dark toggle
without a reload). Steps 6–14 of `specs/121-dsh-kanban/quickstart.md`:

6. Pack both packages (`npm pack` at the root and in `packages/dsh-kanban/`).
7. `DSH_HOME=$(mktemp -d) dsh plugin --profile web add <host-dsh.tgz>
   <dsh-kanban.tgz> --save-exact` — both join the profile (settles **HF-19**).
8. `DSH_HOME=<same> dsh web` in a workspace — the log carries
   `specstride-kanban: server half started <v>`; the page source carries
   `<meta name="specstride-view-token">` (settles **HF-21**, **HF-22**).
9. Open a conversation — the tabs read Chat, Trajectory, Kanban (**HF-17**);
   the served page contains `[data-kanban]`; record which registration field
   carried the component (**HF-18**). An empty workspace shows eight empty
   lanes and "No Specstride run in this workspace".
10. In a workspace with a run: with the pinned CLI the board says
    "Kanban unavailable — run /specstride-doctor" (U-8). After U-8: the run's
    cards on their lanes, moving without a reload.
11. Toggle dsh light → dark → system: the board follows without a reload
    (live half of F121-SC-002; the recorded-token halves are T0xx's static
    test on `tests/fixtures/dsw-tokens.rc8.json`).
12. Restart with the web server on `0.0.0.0` (profile patch `config.host`):
    the log carries `route not registered: web server host is 0.0.0.0`; the
    tab shows the unavailable line; `/specstride/view` answers the SPA
    fallback (HF-26).
13. `specstride-host-dsh doctor`: `ok host.kanban-plugin — installed <v>;
    server half unknown` (or `started` where the log is readable).
14. `dsh plugin --profile web remove @specstride/dsh-kanban`: dsh boots
    without the tab; `host.kanban-plugin` reads `info … not installed`.

After the probe, write `verifiedOn` (and the observed fact, if it differs)
back to the host-facts rows in `src/host-facts.ts`: **HF-18, HF-19, HF-21,
HF-22, HF-23** (HF-23's live-cwd half; the index half of **HF-17** if the
ring behaves as recorded). The person who ran the probe writes them — no
test ever writes `verifiedOn`. The probe configures no model and sends no
prompt (constitution XII); also note **HF-25**'s observation if you watched
the boot log.

## Tests

`npm test` from the repository root runs the plugin's lanes: unit and parity
builders on fixture views, characterization of the kept Lisa behaviours, the
server half against a fake cordis context and a stub CLI, static scans
(no lane assignment, no colour literal, no unscoped rule, no markup sink, no
clock or randomness in builders), the wiring tests, and the real-dsh lane,
which reports `skipped` with its reason when dsh `0.1.0-rc.8` is not on
PATH. No test calls a model.
