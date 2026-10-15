---
"@n-dx/hench": patch
"@n-dx/web": patch
---

Report a run's loop position and the hub's queued requests on `GET /api/live`

The Live overview could list a `--loop` run but not say where in the chain it
was, and it counted the execute requests the hub had queued without naming any
of them.

Hench now records the position on the run record at run start
(`RunRecord.loop`: the mode, the 1-based iteration and, for `--iterations=N`
alone, the planned total), so a run reports its place while it is still going
rather than only once it ends. A run started on its own carries no loop block —
"1 of 1" would be a loop that does not exist. `GET /api/live` exposes it as
`runs[].loop`.

The queued requests reach the project server through the admission header the
hub's proxy already sets on every `/api/live`, narrowed to the project being
proxied the same way `GET /api/hub/queue` narrows under `/p/<id>/`. They are
laid over the cached snapshot as `queue.queued`, named from the PRD index the
answer already holds, so the request does no extra I/O and stays as fast as its
cache makes it. The counts beside the list stay machine-wide, so a project
waiting behind another project's run still sees why.
