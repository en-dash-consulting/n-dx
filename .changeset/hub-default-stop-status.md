---
"@n-dx/core": minor
"@n-dx/web": minor
---

`ndx start` now registers the repository with the per-user hub by default and serves it at `http://localhost:3117/p/<id>/`; `--here` (or `web.mode: "here"`) gets the single-project server that owns the port. `ndx start stop` unregisters the worktree it runs in through the new `DELETE /api/hub/projects/:id/worktrees/:path` — the project keeps being served while another worktree is registered, and the last one unregisters the project and stops its server. A hub left with no projects exits, unless `hub.keepAlive` is set in `~/.n-dx/config.json`. `ndx start status` reports the hub (pid, port, uptime), the project (id, state, server pid and port, repository, registered worktrees) and the URL. New `ndx hub status` and `ndx hub stop` address the hub itself from any directory.
