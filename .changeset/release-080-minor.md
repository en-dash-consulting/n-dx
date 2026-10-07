---
"@n-dx/core": minor
"@n-dx/web": minor
---

Release 0.8.0 · Find your way — a minor release.

The accumulated changesets are individually patches, by the repo's standing rule that a change defaults to `patch` unless a release says otherwise. This one says otherwise: 0.8.0 adds capability rather than only fixing behaviour, so the release is a minor and the fixed group moves together.

What it adds:

- **The hub** serves every registered repository from one per-user process on port 3117, with a project chooser and a reverse proxy at `/p/<id>/`, so several projects no longer contend for a port.
- **Worktree-aware navigation** — a `/w/<key>/` slot in the URL, workspace-tagged WebSocket frames and a breadcrumb switcher, so a branch worktree's PRD, runs and analysis are addressable and writes stay scoped to the worktree the URL names.
- **The Workspaces board**, with each worktree's PRD delta against the anchor and the ability to start a run in another worktree by name.
- **`ndx mcp <server>`**, a shim that forwards a stdio MCP client to the hub with the workspace header, so a desktop session in a worktree reaches that worktree's servers.
- **Hub admission** — a global session cap and memory headroom check that queues a run instead of answering 503.

Changesets takes the highest bump across everything pending, so this is the only entry that needs to say `minor`.
