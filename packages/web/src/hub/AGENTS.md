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
