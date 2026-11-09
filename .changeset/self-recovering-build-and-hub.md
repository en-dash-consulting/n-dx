---
"@n-dx/core": patch
"@n-dx/web": patch
---

n-dx recovers from a stale build itself instead of telling you to rebuild. On a source-linked checkout, `ndx start` (hub, `--here` and `--preview`) rebuilds `@n-dx/web` and the workspace packages it depends on when its `dist/` is older than its source, says so, and then spawns; a command whose package `dist/` is missing builds it and runs; `ndx export` builds a missing viewer. A failed automatic build exits non-zero with the build's own output. A published install missing a built file says it is incomplete and to reinstall.

`ndx start` replaces a running hub that is another build than the one it would start (no build identity, or a different version or source hash): it stops that hub, starts the current build on the same port and home, and brings every project from `hub.json` back on its own `/p/<id>/` URL, then prints the sign-in link as usual. When an agent run or an MCP session is live on the old hub, the replacement is deferred to the first `ndx start` after that work ends, and `--replace-hub` forces it now. Project servers answer `GET /api/mcp/sessions` with how many MCP sessions each endpoint holds open.

A hub running in the other authentication mode than `ndx start` asked for is replaced in the requested mode the same way, instead of `ndx start` asking you to stop it: an open hub becomes a token hub, and a token hub becomes an open one only when the command asked for no token (`--no-auth`, `web.auth=false`), which the notice says. With live work on it the replacement defers, and an open hub still never serves a project that wants the token.

Hub-side faults no longer end in restart advice. A hub started without `--ndx-cli` finds `@n-dx/core` beside its own package; a hub with no n-dx binary looks for its own entry again before each start and health check; `/api/hub/health` reports what is still missing as `faults`, and `ndx start` replaces such a hub. A sidecar stop the hub does not confirm is a note and no longer fails `ndx extensions disable`/`enable`/`remove`/`add`.
