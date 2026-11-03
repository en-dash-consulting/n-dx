# `src/hub/`

The 0.7.0 hub daemon (`web hub`): one process per user owning `hub.json` and
`hub.pid` in the per-user directory, serving `/api/hub/*` and running one
`web serve` child per registered repository on an ephemeral loopback port.

## Import surface

Deliberately small, and the smallness is the point:

- node built-ins, `src/shared/` through its barrel, and `@n-dx/llm-client`'s
  **exec helpers only** through `src/hub/exec-gateway.ts` (re-export, no logic).
  That gateway exists to keep `node:child_process` out of the hub, not to funnel
  everything the foundation tier exports — `registry.ts` imports the layout
  resolver straight from `@n-dx/llm-client`, as `src/server/paths.ts` does,
  because foundation-tier imports are gated only in hench
  (`packages/core/gateway-rules.json`).
- **Nothing from `src/server/` or `src/viewer/`.** The project servers it spawns
  are today's `web serve` unchanged; the hub talks to them over HTTP
  (`GET /api/status`), never by import. The two JSON response helpers in
  `hub/routes.ts` are local for that reason rather than shared with
  `server/response-utils.ts`.
- Consumers import from `src/hub/index.ts`, the barrel.

## The per-user directory is not the hub's to decide

It is `resolveNdxHome`'s answer: `$NDX_HOME`, then `$N_DX_HOME`, then whichever
of `~/.ndx` and `~/.n-dx` exists, defaulting to `~/.ndx`. Tests pass `homeDir`
explicitly, which wins over all of it. Core's `web.js` spawns the hub with the
already-resolved directory in `$NDX_HOME` — the orchestration tier still never
imports this package, and keeps its own hand-written twin of the resolver in
`packages/core/layout.js`.

## Extension sidecars

`hub/sidecars.ts` runs the sidecars mounted at `/x/<name>/` — lazy start,
health wait, idle stop, crash backoff, the memory floor. The hub never reads a
manifest: it spawns `ndx extensions sidecar <name> --json` (core's CLI, passed
as `--ndx-cli`) for a launch plan and runs exactly that, so discovery, approval
and the config check stay in core. Sidecars are always stopped with the hub,
even when `close({ stopChildren: false })` leaves project servers to be
re-attached, because nothing records them for the next hub.

The proxy treats a sidecar as untrusted code: the token is checked at the hub's
boundary like any request, then `sidecarHeaderValue` (proxy.ts) drops every place
it rides — `X-Ndx-Token`, the `ndx_token` cookie, a bearer carrying it — from
HTTP and WebSocket requests alike, and `X-Ndx-Base-Path: /x/<name>/` is added.
Unknown, disabled and unapproved names are all 404, with core's `reason` in the
body. `x` is reserved as a project id (`isReservedProjectId`, twinned in
`packages/core/web.js`): registration refuses it and derivation hashes it.

**Versioned API.** `GET`/`POST /api/hub/projects` and `/api/hub/extensions`
(list, `:name/stop`) are the extension API, stable under `apiVersion` 1
(docs/architecture/extensions.md, "Versioned hub API"). Their answers carry
`apiVersion`; removing or retyping a field there needs a bump and an update to
`tests/integration/hub-extension-api.test.ts`. `hub/extensions.ts` gets the list
from `ndx extensions list --json`, and its `EXTENSION_API_VERSION` is core's
twin, pinned by the root `extension-api-version-parity` test.

## The hub session

`/hub/session/…` is the hub-scope Sidecar session, one per machine. The hub
spawns no vendor CLI for it: `proxy.ts` forwards it, HTTP and WebSocket, to
`/api/sidecar/hub/…` on the host `hub/session-host.ts` picks — the holder of
`<ndx home>/hub/sidecar/host.lock` while healthy, else the first healthy
project, skipping one it just failed to reach. State lives under
`<ndx home>/hub/sidecar/`, so a new host resumes it; the paths are in
`src/shared/base-path.ts`, shared with `server/routes-sidecar.ts`. Every route
here is reached only past `guardHubRequest`; add no path that skips it.

Its spend is the machine's: hosts append each turn to `<ndx home>/hub/usage.jsonl`
(`hub/usage-ledger.ts`), never their own usage ledger, and the home shows the total.

The home offers it only when `probeHubLens` (session-host.ts) gets a yes from
the host it would pick: a toggle (⌘J) docks an iframe of `/hub/session/drawer`,
the drawer-only page the host builds (`viewer/hub-session.ts`). `home.ts` stays
server-rendered with no Preact; the frame posts `HUB_SESSION_CLOSE_MESSAGE` to
undock. The host injects the page's paths, so they do not cross
`viewer/external.ts`.

## Proxy and base path

`hub/proxy.ts` forwards `/p/<id>/…` to that project's server with the prefix
stripped (HTTP streamed, WebSocket upgrades piped over `node:net`), and aliases
the root to the sole registered project; with several registered, `/` is a
project list and other root paths answer 409 with the ids.

The viewer derives the same prefix from `location.pathname` at boot
(`viewer/base-path.ts`), and both sides use `src/shared/base-path.ts`, so where
the prefix ends is defined once. **New viewer code must not hand-build
`ws://…${location.host}` or `location.origin + "/api/…"`** — go through
`installBasePathFetch()`, `getWebSocketUrl()` and `appUrl()`.

**Workspace slot.** The viewer's base path also carries `/w/<key>` when it
addresses a worktree other than the anchor (`detectViewerBasePath`), so
`/p/app/w/feature/prd` and `/w/feature/prd` deep-link to that worktree's tree.
The project server strips the slot in `start.ts` before dispatch
(`stripWorkspaceSlot`), resolves the workspace in the registry, and answers an
unknown key with a 404 page linking to the anchor; `X-Ndx-Workspace` does the
same for non-browser clients. Routes never see the slot.
