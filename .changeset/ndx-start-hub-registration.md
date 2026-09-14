---
"@n-dx/core": minor
---

`ndx start` registers with the multi-project hub (0.7.0 / PR 10).

A bare `ndx start [dir]` now resolves the repository through `git worktree list --porcelain` (repoRoot = the main worktree, the invoked checkout recorded as a linked worktree), derives a stable project id from `.rex/config.json`'s `project` name (repo basename fallback; a 6-char origin-URL hash is appended only when the registry already holds that id for a different repo), starts the hub daemon detached if none answers on the hub port (`~/.n-dx/config.json` `hub.port`, default 3117), registers via `POST /api/hub/projects`, prints the `/p/<id>/` URL plus per-project MCP endpoints, and exits — the hub and its per-repo server keep running. `--open` also opens the browser.

The 0.6.0 single-project server remains byte-for-byte reachable: `--here`, an explicit `--port`, a configured `web.port`, `--background`, and the `stop`/`status` subcommands all take the legacy path untouched. Orchestration stays spawn-only — the hub is spawned (`web hub`), never imported, and all state flows over HTTP and the hub's own files. `N_DX_HUB_DIR` is a test seam for the state directory.
