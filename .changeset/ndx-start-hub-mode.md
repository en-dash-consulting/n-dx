---
"@n-dx/core": minor
---

`ndx start --hub` (or `web.mode: "hub"` in `.n-dx.json`) registers the repository with the per-user hub instead of starting a single-project server: it resolves the repository through `git worktree list` (main checkout as `repoRoot`, the started directory's checkout as the worktree), derives a stable project id from `.rex/config.json`'s `project` (hash-suffixed only on a clash with a different repository), starts the hub detached if `~/.n-dx/hub.pid` / `GET /api/hub/health` do not answer, registers via `POST /api/hub/projects`, and prints the `/p/<id>/` URL and MCP endpoints (`--open` opens the browser). `--here` forces today's single-project server, which remains the default until `stop`/`status` learn hub mode. `$N_DX_HOME` overrides `~/.n-dx`; `~/.n-dx/config.json` `hub.port` overrides 3117.
