---
"@n-dx/core": patch
"@n-dx/web": patch
"@n-dx/llm-client": patch
---

n-dx recovers from a stale build itself instead of telling you to rebuild. On a source-linked checkout, `ndx start` (hub, `--here` and `--preview`) rebuilds `@n-dx/web` and the workspace packages it depends on when its `dist/` is older than its source, says so, and then spawns; a command whose package `dist/` is missing builds it and runs; `ndx export` builds a missing viewer. A failed automatic build exits non-zero with the build's own output. A published install missing a built file says it is incomplete and to reinstall.

`ndx start` replaces a running hub that is another build than the one it would start (no build identity, or a different version or source hash): it stops that hub, starts the current build on the same port and home, and brings every project from `hub.json` back on its own `/p/<id>/` URL, then prints the sign-in link as usual. When an agent run or an MCP session is live on the old hub, the replacement is deferred to the first `ndx start` after that work ends, and `--replace-hub` forces it now. Project servers answer `GET /api/live-work` with what a restart would cut off: open MCP sessions and Sidecar turns in progress, the hub-scope Sidecar's included, all of which defer a replacement.

A hub running in the other authentication mode than `ndx start` asked for is replaced in the requested mode the same way, instead of `ndx start` asking you to stop it: an open hub becomes a token hub, and a token hub becomes an open one only when the command asked for no token (`--no-auth`, `web.auth=false`), which the notice says. With live work on it the replacement defers, and an open hub still never serves a project that wants the token.

Hub-side faults no longer end in restart advice. A hub started without `--ndx-cli` finds `@n-dx/core` beside its own package; a hub with no n-dx binary looks for its own entry again before each start and health check; `/api/hub/health` reports what is still missing as `faults`, and `ndx start` replaces such a hub. A sidecar stop the hub does not confirm is a note and no longer fails `ndx extensions disable`/`enable`/`remove`/`add`.

`ndx start` replaces only a hub older than itself: one with no build identity, an older `@n-dx/web` version, or an earlier build of the same checkout (`/api/hub/health` now reports the hub's package root). A newer hub, or one started from another checkout, keeps serving, with a one-line note.

When the automatic rebuild of a `dist/` that is there but lags its source fails, or another process still holds the rebuild after the wait, `ndx start` warns with the build's output and goes on with the existing build, leaving an older hub serving; only a missing build is fatal.

When `ndx start` replaces the hub, signed-in dashboard tabs stay signed in: the old hub hands its live sessions (as digests, in an owner-only file the new hub deletes on reading) to the new one. `ndx hub stop` still signs every tab out. `@n-dx/llm-client` exports `writeOwnerOnlyFile`.
