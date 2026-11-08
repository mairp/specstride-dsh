# contracts/view-route.md — the view route (F121-FR-004, F121-FR-007, F121-FR-010, F121-FR-015)

One route serves the kanban pane: `GET /specstride/view?session=<id>&cursor=<token>`.
`session` identifies the run workspace; `cursor` is optional and echoes back the
cursor token the client received from its previous `view` answer (each browser
tab — each poller — owns its own cursor; two tabs therefore hold two cursors and
neither consumes the other's change).

The reply is always JSON with the three hardening headers
(`Cache-Control: no-store`, `Content-Security-Policy: default-src 'none'`,
`X-Content-Type-Options: nosniff`).

## The answer table

| `answer`     | Body                                                       | Meaning                                                              |
| ------------ | ---------------------------------------------------------- | -------------------------------------------------------------------- |
| `view`       | `{ answer, view, cursor: { token } }`                      | A fresh RunView; `cursor.token` is the new read cursor.              |
| `unchanged`  | `{ answer, cursor: { token } }`                            | The cursor still matches the workspace; nothing new to render.       |
| `unavailable`| `{ answer, line }`                                         | The engine CLI could not be answered (`line` is the banner line).    |
| `no-run`     | `{ answer }`                                               | The session resolves to no workspace / no run (0 CLI calls).         |
| `refused-schema` | `{ answer, line }`                                     | The view schema was refused; `line` is the refusal line.             |
| `method-not-allowed` | `{ answer }` (405, `Allow: GET`)                    | Non-GET request.                                                     |
| `bad-request`| `{ answer }` (404)                                         | Wrong path.                                                          |

## What the client does

The poller polls every 5 s while the pane is open, with **at most one request
outstanding at every instant** (a new request is only ever scheduled after the
previous one settled), and every answer is handled row by row:

| Row                                     | What the client does                                                                                                                                                                      |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `view`                                  | Re-render from the new view only: the previous tree is discarded, the cursor token and the "last good" time are recorded, the staleness banner is removed, the next poll is 5 s away and the backoff is reset. |
| `unchanged`                             | No re-render: the last view stays on screen exactly as it was; the cursor token is refreshed when the answer carries one; the next poll is 5 s away.                                      |
| `unavailable`                           | Keep the last view and add the banner `Not updated since <time>` with the time of the last good view; back off 1 s, 2 s, 4 s … capped at 30 s until a good answer.                        |
| network error (fetch throws / bad JSON) | Exactly the `unavailable` row: keep the last view, banner, backoff.                                                                                                                       |
| client limit (no answer within 35 s)    | Abort the outstanding request, keep the last view, add the same banner, and continue polling under the same backoff.                                                                       |
| `no-run` / `refused-schema`             | Keep the last view (or nothing, before the first view) and surface the answer's line; the poll keeps its 5 s cadence.                                                                       |

Backoff restarts at 1 s after every good answer (`view` or `unchanged`), doubles
per failure and never exceeds 30 s.
