---
"@n-dx/web": patch
---

A dashboard can now see the hub's admission queue. `GET /api/hub/queue` is answered under a project prefix too (`/p/<id>/api/hub/queue`), which is the only address a viewer has — its fetches are rewritten to sit under the page's base path, so the hub's own API was previously unreachable from the page the hub serves. Asked that way, the queued entries are scoped to that project while the running count, limits and memory state stay machine-wide, since waiting behind another project's run is exactly what needs explaining. A new `useHubQueue` hook polls it, tolerating the single-project server where no hub answers.
