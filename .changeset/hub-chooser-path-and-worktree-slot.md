---
"@n-dx/web": patch
---

Serve the hub's project chooser at a fixed `/hub`, and answer `/api/hub/*` under a worktree slot.

`/` is the chooser only while two or more projects are registered; with one it opens that project's dashboard, so a dashboard had no stable address to link back to. `/hub` and `/hub/` now return the chooser whatever is registered, while `/` keeps its single-project alias. A WebSocket upgrade at `/hub` is refused rather than forwarded to a project that never served the page.

The hub also now answers its own API under a worktree slot — `/w/<key>/api/hub/*` and `/p/<id>/w/<key>/api/hub/*`. The viewer's base path carries the slot on a worktree page and `installBasePathFetch` puts it on every root-relative fetch, so those requests were being proxied to a project server that 404s on them. Because the run-queue strip reads a 404 as "there is no hub", the strip was silently empty on every worktree page rather than reporting an error. The slot is dropped before dispatch, since no hub answer is per worktree; the project prefix still scopes the queue to that project.

`HUB_PATH` is defined once in `src/shared/base-path.ts` and read by both the hub's routing and the viewer's `hubUrl()`.
