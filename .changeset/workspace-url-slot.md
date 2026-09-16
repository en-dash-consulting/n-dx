---
"@n-dx/web": minor
---

`/w/<key>/` URL slot for worktrees. The viewer's base path now carries the workspace slot alongside the hub's `/p/<id>` prefix, so `/w/feature/prd` (or `/p/app/w/feature/prd`) deep-links to that worktree's tree and every fetch, socket and history entry the viewer builds keeps the slot. The project server strips the slot before dispatch and resolves the workspace in the registry, accepts `X-Ndx-Workspace` for non-browser clients, answers an unknown key with a 404 page linking to the anchor, and serves slot-less paths from the anchor exactly as before.
