# `src/server/`

Rules for the server composition root. The reasoning behind each is in
[docs/architecture/web-server.md](../../../../docs/architecture/web-server.md);
`src/hub/AGENTS.md` covers the hub daemon.

## Request gate: Host first, then Origin

Both servers are loopback-only and unauthenticated, so the gate *is* the access
control against a page the operator has open. Two rules, in order, both in
`src/shared/origin.ts` so the hub (`hub/request-guard.ts`) and the project
server (`server/request-security.ts`) cannot drift:

1. **Host must name loopback on this socket's port** — `localhost`,
   `127.0.0.1` or `[::1]`, exact port, round-tripping through the URL parser
   unchanged. Anything else is `421 Misdirected Request`, on `GET` as much as
   `POST`.
2. **A present `Origin` on a mutation must be this server's own**, compared
   against the socket port, never `Host`. `Sec-Fetch-Site: cross-site` with no
   `Origin` is refused too; safe methods with a foreign `Origin` pass
   unreflected.

- **Every listener gets the gate.** A new `createServer` here calls
  `handleRequestSecurity` (or the hub's `guardHubRequest`) before routing, and
  its `upgrade` handler applies `isTrustedHost` plus the origin check.
- **Sidecar broker key:** the one other credential — [rule](../../../../docs/architecture/web-server.md#sidecar-broker-key).
- **`GET` must be read-only** — one that writes a file or spawns a process is a
  bug even on loopback.
- **Internal clients use a loopback name**, never the machine's hostname or
  `0.0.0.0`. Tunnels and port-forwards are unsupported by construction; making
  one work needs an explicit Host allowlist, not a relaxed check.
- **Tests build requests by hand** — `fetch()` will not send a foreign `Host`.
  Use `node:http` with `setHost: false`, as `tests/integration/hub-proxy.test.ts` does.

## PRD writes are workspace-scoped

Every PRD-writing route resolves its target from `ctx.rexDir`, which is whichever
workspace the request addressed — the `/w/<key>/` slot or `X-Ndx-Workspace`. A
write made while viewing a branch worktree rewrites *that* worktree's tree and
leaves the anchor's untouched. The PRD lock is per `rexDir`, one per workspace,
so two worktrees neither contend nor serialize.

- **No cross-workspace write action.** No route takes a workspace parameter and
  no UI offers "apply to the anchor instead"; switching workspace is a full
  navigation through the breadcrumb switcher. Otherwise the write target becomes
  something the reader has to check rather than something the URL states.
- **The write target is stated, not inferred** — `WorkspaceWriteStrip` names a
  non-anchor workspace in the PRD view and renders nothing on the anchor.
- **A header naming no known worktree is a 404**, on reads as much as writes;
  falling back to the anchor would answer under a name the caller did not ask
  for. The dispatcher re-reads the worktree list once before refusing, because
  the registry only rescans every 30s.
- **The Workspaces board is the one cross-workspace reader**, deliberately and
  in one direction: it addresses each worktree by header, its only
  cross-workspace action is Start working / Stop, and it is the one socket
  consumer that must *not* call `acceptsFrame`.

`tests/integration/workspace-scoped-prd-writes.test.ts` hashes both trees around
each write, so a route that wrote both fails.

## Routes that write hold the PRD lock

Most routes treat disk as read-only. The PRD is the exception: item CRUD, merge,
prune, reorganize, restore, `apply-refinements` and `PUT /api/hench/prep/:taskId`
resolve a store through `rex-gateway` and hold the file lock for the span of
`withTransaction`; the v2 product edit and the Inbox place and propose routes
hold it through `withPrdModelTransaction`. The server is therefore a first-class PRD writer alongside
`ndx work` and the MCP tools — which is why a lock failure surfaces, naming the
holder's PID, instead of retrying or writing anyway. A writing route also calls
`refreshPRDCache`.

## Web injection seam registry

> `.claude/rules/web-injection-seams.md` scopes this section to `src/server/`
> for Claude Code; the text lives here so every assistant reads it.

Some cross-zone dependencies use callback injection rather than gateway imports.
These seams are invisible to `boundary-check.test.ts` and `domain-isolation.test.js`,
so replacing one with a direct import breaks nothing a test can see.

| Injection site | Target module | Injected callbacks | Interface type |
|----------------|---------------|---------------------|-----------------|
| `start.ts` | `task-usage.ts` — the barrel facade, re-exporting `task-usage/register-scheduler.ts`; import the facade, never the subdirectory file | `broadcast`, `collectAllIds`, `loadPRD`, `getAggregator` | `RegisterSchedulerOptions` |
| `start.ts` | `workspaces.ts` (`WorkspaceRegistry`) — hooks built by `createWorkspaceHooks` in start.ts, which owns the watcher registration; the registry must not import start.ts | `setup(ctx)` → watchers + PRD cache for a worktree, `teardown(handles)` | `WorkspaceHooks` |
| `start.ts` | `routes-live.ts`, and through it `routes-live-analyze.ts` — built by `liveSourcesOf` in start.ts so the Live routes never import the workspace registry | `listWorkspaces()`, `memoryFloorBytes()` (optional; defaults to the hub config) | `LiveSources` |

- **Prefer injection over import** when the target would otherwise import from a
  higher-tier zone.
- **Document the interface type** — a named interface, never inline parameter
  types, so refactoring either side is a type error.
- **New seams** need a row here and a named interface in the target module.
