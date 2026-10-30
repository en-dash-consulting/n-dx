# Web server: request gate, concurrency and workspaces

The reasoning behind the rules in `packages/web/src/server/AGENTS.md`. The rules
themselves are there, beside the code; this page is why they are what they are.

## Request gate: Host first, then Origin

Both servers are loopback-only and unauthenticated, so the request gate *is*
the access control against a web page the operator has open. It has two rules,
applied in this order, and both live in `src/shared/origin.ts` so the hub
(`hub/request-guard.ts`) and the project server (`server/request-security.ts`)
cannot drift:

1. **Host must name loopback on this socket's port** — `localhost`,
   `127.0.0.1` or `[::1]`, with the exact port, round-tripping through the URL
   parser unchanged. Anything else is `421 Misdirected Request`, for `GET` as
   much as `POST`. Behind the hub the proxy rewrites `Host` to
   `127.0.0.1:<child port>`, so a project server only ever judges requests made
   to it directly.
2. **A present `Origin` on a mutation must be this server's own**, compared
   against the socket port (never `Host`); `Sec-Fetch-Site: cross-site` without
   an `Origin` is refused too. Safe methods with a foreign `Origin` pass
   unreflected — the page cannot read them without the CORS header.

Consequences for new code:

- **Every listener gets the gate.** A new `createServer` in this package calls
  `handleRequestSecurity` (or the hub's `guardHubRequest`) before routing, and
  its `upgrade` handler applies `isTrustedHost` + the origin check. The
  dashboard, the hub and the preview server all do.
- **`GET` must be read-only.** A safe method must not have side effects; a
  `GET` that writes a file or spawns a process is a bug even on loopback.
- **Internal clients must use a loopback name.** The hub's health probes and
  overview fetches use `127.0.0.1:<port>`; a client that reached a server by
  the machine's hostname or `0.0.0.0` would now get 421. Remote access through
  a tunnel or devcontainer port-forward is unsupported for the same reason — if
  it ever becomes a feature it needs an explicit Host allowlist setting, not a
  relaxed check.
- **Tests build requests by hand.** `fetch()` will not send a foreign `Host`;
  use `node:http`'s `request` with `setHost: false` (see
  `tests/integration/hub-proxy.test.ts`) or the mock request helpers in the
  unit tests, which default `Host` to the socket so origin tests exercise the
  origin rule.

## Sidecar broker key

A Sidecar session's CLI reaches the broker with a per-session key minted in
`sidecar/broker-credential.ts`, not the dashboard token. The gate accepts it
only on a `POST` to that session's raw `/api/sidecar/sessions/<id>/mcp` target;
every other route, method or session answers 401. The session can read its own
MCP config file, so that file never carries the token.

## HTTP-request concurrency

When `ndx start` is running, the web server holds in-process caches (aggregation cache, PRD tree snapshot) that are populated from disk on demand. External CLI commands that write to the same files can cause stale or partial reads:

| Scenario | Risk | Mitigation |
|----------|------|------------|
| Dashboard reads PRD while `ndx plan` writes to `.rex/prd_tree/` | Partial aggregate read or stale derived JSON | Restart server after plan (`ndx start stop && ndx start`) |
| MCP request during `ndx work` PRD update | Momentarily stale status — hench writes are small atomic updates | Acceptable — dashboard polls and self-corrects within seconds |
| Concurrent dashboard API requests | Safe — Express serializes requests per-connection; no shared mutable state between request handlers | No action needed |

**General rule for HTTP:** most routes treat disk files as read-only. The exception is the PRD: the routes that mutate `.rex/prd_tree/` (item CRUD, merge, prune, reorganize, restore, the Ask panel's `apply-refinements`, and `PUT /api/hench/prep/:taskId` — the Prepare task modal's Save) go through `rex-gateway`'s `resolveStore` and hold the PRD file lock for the span of `withTransaction`. That makes the server a first-class PRD writer alongside `ndx work` and the MCP tools, and it is why those routes surface a lock-acquisition failure — which names the holder's PID — rather than retrying or writing anyway.

The folder tree watcher refreshes `.rex/.cache/prd.json` automatically for most PRD mutations; routes that write also call `refreshPRDCache` so their own change is visible to the next read without a restart. Any command that bulk-rewrites `.sourcevision/` (ci, refresh) should be followed by a server restart to flush stale caches.

## Writes are workspace-scoped

Every PRD-writing route resolves its target from `ctx.rexDir` — through
`resolveStore(ctx.rexDir)` in `routes-rex/items.ts`, `prune.ts`, `health.ts`,
`refinements.ts` (which is where the Ask panel's accepted proposals land, via
`POST /api/rex/apply-refinements`), `requirements.ts`, `routes-rex-analysis.ts`
and `routes-hench-prep.ts` (`PUT /api/hench/prep/:taskId`, which saves a task's
own run settings and is the one writer outside `routes-rex/`); and by path in
`restore.ts`, which restores from that workspace's `.rex/.backups`.
Since PR 12 that ctx is whichever workspace the request addressed —
the `/w/<key>/` slot or `X-Ndx-Workspace` — so a write made while viewing a branch
worktree rewrites **that worktree's** `.rex/prd_tree/` and leaves the anchor's
untouched. The PRD lock is per `rexDir` (`prdLockPath`), one per workspace: two
worktrees write concurrently without contending, and equally, the lock does not
serialize them against each other. Nothing needs it to — they are different trees.

Two rules follow, and both are load-bearing:

- **No cross-workspace write action.** No route takes a workspace as a parameter,
  and no UI offers "apply to the anchor instead". Editing the anchor's PRD while
  viewing a branch requires switching workspace through the top bar's workspace switcher,
  which is a full navigation. A cross-workspace affordance would make the write
  target a thing the reader has to check rather than a thing the URL states.
- **The write target is stated, not inferred.** `WorkspaceWriteStrip`
  (`viewer/components/workspace-write-strip.ts`) renders a one-line strip in the
  PRD view for a non-anchor workspace only. On the anchor it renders nothing —
  a permanent banner on the common case is noise.

`tests/integration/workspace-scoped-prd-writes.test.ts` pins this by hashing both
trees around each write; a route that wrote both would fail it.

## The Workspaces board is the one cross-workspace reader

`viewer/views/workspaces.ts` is the exception to both rules above, deliberately
and in one direction only. It is *about* the set of worktrees, so it addresses
each one explicitly with the `X-Ndx-Workspace` header rather than the `/w/<key>/`
slot — the slot is already spent on whichever workspace the viewer itself is
mounted under, and the server reads the header ahead of the slot
(`workspaceFromHeader` in the dispatcher, not the lenient `resolveWorkspace`).
Four endpoints answer for the whole repository and are fetched plainly
(`/api/workspaces`, `/api/worktrees`, `/api/hench/memory`, `/api/live`); the
rest are per workspace. `/api/live` (`routes-live.ts`) is the Live tab's one
read — every worktree's running runs and jobs, the queue, the machine strip —
built from the registry's list and the digest cache behind `/api/worktrees`,
never from `git` per request. Its `live:changed` frame is tagged `"*"`, like
the memory monitor's.

**A header naming no known worktree is a 404, on reads as much as on writes.**
Falling back to the anchor would answer under a name the caller did not ask
for: a write to the wrong tree, or — on the board's per-card polling — the
anchor's running task painted onto another worktree's card. Refusing is safe
because only a fetch ever sets this header (`workspaceFetch`,
`StartTaskButton`), never a navigation, so no page load can 404 on it. The
dispatcher re-reads the worktree list once before refusing, since the registry
only rescans every 30s and a worktree created since the last tick would
otherwise be rejected for no reason. `respondUnknownWorkspaceHeader` answers
JSON naming the key and the keys that do exist; `StartTaskButton` already
renders that `error` field.

Two constraints keep this from eroding the rules:

- **No route gained a workspace parameter.** The header is the existing
  addressing mechanism, not a new one. A request made with it *is* that
  workspace's request — `ctx` resolves the same way it does for a `/w/<key>/`
  navigation, so the run it starts has that worktree as its cwd and writes that
  worktree's tree. Nothing writes across a boundary.
- **The only cross-workspace action is Start working / Stop.** Starting an agent
  in another worktree names the worktree on the button
  (`StartTaskButton`'s `workspace` prop, which sets the header). Editing a PRD
  item still requires navigating there — the board links, it does not edit.

Because it is about every worktree, it is also the one socket consumer that must
**not** call `acceptsFrame`: a run progressing in worktree B is exactly what
should move B's card while the viewer sits on A. It reads the `workspace` tag
itself (`frameWorkspace`) and refreshes only that workspace's slice, falling back
to a whole-board reload for a `"*"` frame or an unrecognised key.

## web-server zone stability

`web-server` (composition root — Express routes, gateways, MCP handlers) is prone to dissolving into `web-viewer` in Louvain analysis because server files import from `packages/web/src/shared/` (required by the barrel-import policy), and shared files are also imported by viewer files, creating a Louvain connectivity bridge. If the zone dissolves:

1. Check `stability.reassignedFiles` in `.sourcevision/zones.json` for `[file, "web-server", "web-viewer"]` entries
2. Update `.sourcevision/hints.md` with re-analysis guidance
3. The zone pins in `.n-dx.json` targeting `"web-server"` are no-ops when the zone is absent — they will re-activate if the zone re-appears in Louvain output
4. The actual server/viewer boundary is enforced by `boundary-check.test.ts` regardless of zone detection — zone dissolution is a metrics artifact, not an architectural violation

## See also

- [Architecture Overview](overview.md) — the tiers the web package sits across
- [Gateway Modules](gateways.md) — the gateways the server wires
- [PRD write concurrency](prd-write-concurrency.md) — the lock the PRD routes take
