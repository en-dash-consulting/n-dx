---
"@n-dx/web": minor
"@n-dx/llm-client": patch
---

Hub daemon skeleton: `web hub` command, ~/.n-dx registry and pid file, /api/hub/\* routes, spawn/attach per-repo servers with health checks (0.7.0 / PR 8).

A single hub process per user owns the machine-wide concerns: a project registry at `~/.n-dx/hub.json` (atomic writes; corruption reads as empty, entry by entry), a pid file `~/.n-dx/hub.pid`, and one server process per registered repository — today's `web serve`, unchanged, on an ephemeral loopback port, so each repo can run its own n-dx version.

Routes: `GET /api/hub/health`, `GET /api/hub/projects`, `POST /api/hub/projects { id, repoRoot, worktree, ndxBin }` (spawns `<ndxBin> serve --port=0 <repoRoot>`, discovers the bound port from `<repoRoot>/.n-dx-web.port`; idempotent for an already-running id), `DELETE /api/hub/projects/:id` (stops the child with SIGTERM → grace → SIGKILL escalation). On restart the hub re-attaches children whose recorded pid is alive and answering `/api/status`, and respawns the rest; a health sweep every 15 s marks unreachable children and respawns each at most once per outage. Hub shutdown stops its children.

The new `src/hub/` directory is its own zone: node built-ins, hub siblings, `src/shared`, and the llm-client exec helpers via a new re-export-only `src/hub/llm-gateway.ts` — enforced by a hub-containment assertion in `boundary-check.test.ts`. The reverse proxy under `/p/:id/`, the sole-project root alias, and per-project MCP endpoints are the epic's remaining tasks, not part of this change.

@n-dx/llm-client: `SpawnToolOptions.stdio` accepts `"ignore"` — a daemon's long-lived children must not accumulate piped output nobody reads, and `"inherit"` would interleave theirs with the daemon's own.
