---
"@n-dx/web": minor
---

Add the hub daemon skeleton (`web hub`, default port 3117): a per-user registry at `~/.n-dx/hub.json` with atomic writes, a `~/.n-dx/hub.pid` file, and `/api/hub/*` routes (`GET /health`, `GET|POST /projects`, `GET|DELETE /projects/:id`). Registering a project spawns `<ndxBin> serve --port=0 <repoRoot>`, reads the bound port from `<repoRoot>/.n-dx-web.port`, and records pid and port. Children are health-checked every 15 s via `GET /api/status`, marked unreachable when they stop answering, and respawned once. On restart the hub re-attaches to children whose recorded pid is alive and answering, and respawns the rest. `$N_DX_HOME` overrides the registry directory.
