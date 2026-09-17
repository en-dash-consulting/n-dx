## Web package internal zone layering

The web package decomposes into a hub topology with `web-viewer` at the centre:

```
  web-server          (composition root — Express routes, gateways, MCP handlers)
       ↓                    ↓ (serves static assets only, no runtime import)
  web-viewer          (Preact UI hub — components, hooks, views)
       ↑ ↓                  ↓
  viewer-message-pipeline  (messaging middleware — coalescer, throttle, rate-limiter, request-dedup)
       ↓                    ↓
  src/shared/         (framework-agnostic utilities — data-files, features, view-id, view-routing)
```

`web-viewer` is the hub: it imports from `viewer-message-pipeline` (via `external.ts`) and `src/shared/`, while also receiving imports from sub-zones like `crash/`. `web-server` is a parallel composition root — it wires gateways and routes but does not import from `web-viewer` at runtime (the viewer is built separately and served as static assets). `src/shared/` is the foundation layer with zero upward dependencies, enforced by `boundary-check.test.ts`.

Latest analysis (2026-08-24, `main`): `web-viewer` 205 files (cohesion 0.98 / coupling 0.02), `web-server` 62 (0.96 / 0.04), `viewer-message-pipeline` 7 (1.00 / 0.00), `web-composition-layer` 4 (0.65 / 0.35). No web zone currently meets the dual-fragility threshold. Re-run `ndx analyze --deep .` rather than trusting these numbers.

**The sections below are directory policies, not zone policies.** Louvain does not currently emit standalone `web-shared`, `crash`, or `viewer-ui-hub` zones, but the directories exist and the rules are enforced by `boundary-check.test.ts` — so they remain in force. See the root `CLAUDE.md` for the threshold definition and universal rules.

## `src/shared/` addition policy

`src/shared/` holds 5 framework-neutral modules (`data-files.ts`, `features.ts`, `index.ts`, `view-id.ts`, `view-routing.ts`). Because both server and viewer files import it, Louvain typically absorbs it into `web-viewer` rather than emitting a separate `web-shared` zone — that is a detection artifact, not a boundary violation, and the rules below apply regardless:

- **Framework-agnostic only:** `src/shared/` must not contain Preact/React imports or server-only (`node:*`) imports. If a utility needs framework APIs, it belongs in the consuming zone.
- **Barrel import enforcement:** Consumers must import through `shared/index.ts` rather than directly from leaf files (`data-files.ts`, `view-id.ts`). Enforced by `boundary-check.test.ts`.
- **Two-consumer rule (automated):** Every module in `shared/` must have at least two distinct consumer zones. Enforced by the "shared/ modules have at least two consumer zones" assertion in `boundary-check.test.ts`.

## `crash/` proactive governance

`crash/` (`crash-detector.ts` + `index.ts`) is imported unidirectionally by `web-viewer` and reaches into `src/shared/` directly — a documented bypass. Barrel enforcement (imports must enter through `crash/index.ts`) is asserted by `boundary-check.test.ts`. Apply the two-consumer rule proactively to new additions here.

## UI composition governance

The viewer's UI composition layer (sidebar, config-footer, faq, logos) is a composition root: it imports broadly from `web-viewer` while its internal files serve distinct UI concerns. Louvain currently reports this as `web-composition-layer` (4 files, cohesion 0.65 / coupling 0.35); earlier revisions called it `viewer-ui-hub` with different metrics. Low cohesion here is **structurally expected** and not by itself a defect.

- **No domain logic:** This layer must contain only UI composition components and their direct rendering helpers. Data fetching and state management belong in hooks or views.
- **Monitor fan-out:** Its coupling with the dashboard platform zone is the largest cross-zone relationship in the web package — audit import direction periodically to ensure inbound imports enter through `api.ts` or composition-root wiring rather than ad-hoc leaf reach-ins.

## web-server zone stability

`web-server` (composition root — Express routes, gateways, MCP handlers) is prone to dissolving into `web-viewer` in Louvain analysis because server files import from `packages/web/src/shared/` (required by the barrel-import policy), and shared files are also imported by viewer files, creating a Louvain connectivity bridge. If the zone dissolves:

1. Check `stability.reassignedFiles` in `.sourcevision/zones.json` for `[file, "web-server", "web-viewer"]` entries
2. Update `.sourcevision/hints.md` with re-analysis guidance
3. The zone pins in `.n-dx.json` targeting `"web-server"` are no-ops when the zone is absent — they will re-activate if the zone re-appears in Louvain output
4. The actual server/viewer boundary is enforced by `boundary-check.test.ts` regardless of zone detection — zone dissolution is a metrics artifact, not an architectural violation

## Feature-toggle enforcement

Toggles in `routes-features.ts`'s registry are enforced in the viewer by
`useFeatureToggle` — the sidebar and the SourceVision tab list read them, and any
*other* entry point into a gated surface must read the same toggle. The Explain
button on Problems and Suggestions is the worked example: it is not in the sidebar,
so gating the sidebar alone left a default-off feature reachable through a side door
whose only off switch the toggle itself had hidden. Views that cannot call the hook
(both of those return early from an enrichment gate before their hooks run) take the
value as a prop from `main.ts` via `ViewRenderContext`, defaulting to `false`.

**Server-side enforcement is per-toggle, not universal.** Use
`isFeatureEnabled(projectDir, key)` from `routes-features.ts` when a route must not
act with its feature off; it reads `.n-dx.json` per call (toggles change while the
server runs) and fails closed. Today only `sourcevision.ask` is gated this way,
because each call spends tokens. `sourcevision.prMarkdown` is viewer-gated only —
it renders from analysis already on disk, so a direct request costs nothing. Decide
new toggles on that basis rather than by copying whichever neighbour is closest.

## HTTP-request concurrency (web server)

When `ndx start` is running, the web server holds in-process caches (aggregation cache, PRD tree snapshot) that are populated from disk on demand. External CLI commands that write to the same files can cause stale or partial reads:

| Scenario | Risk | Mitigation |
|----------|------|------------|
| Dashboard reads PRD while `ndx plan` writes to `.rex/prd_tree/` | Partial aggregate read or stale derived JSON | Restart server after plan (`ndx start stop && ndx start`) |
| MCP request during `ndx work` PRD update | Momentarily stale status — hench writes are small atomic updates | Acceptable — dashboard polls and self-corrects within seconds |
| Concurrent dashboard API requests | Safe — Express serializes requests per-connection; no shared mutable state between request handlers | No action needed |

**General rule for HTTP:** most routes treat disk files as read-only. The exception is the PRD: the routes that mutate `.rex/prd_tree/` (item CRUD, merge, prune, reorganize, restore, and the Ask panel's `apply-refinements`) go through `rex-gateway`'s `resolveStore` and hold the PRD file lock for the span of `withTransaction`. That makes the server a first-class PRD writer alongside `ndx work` and the MCP tools, and it is why those routes surface a lock-acquisition failure — which names the holder's PID — rather than retrying or writing anyway.

The folder tree watcher refreshes `.rex/.cache/prd.json` automatically for most PRD mutations; routes that write also call `refreshPRDCache` so their own change is visible to the next read without a restart. Any command that bulk-rewrites `.sourcevision/` (ci, refresh) should be followed by a server restart to flush stale caches.

### Writes are workspace-scoped

Every PRD-writing route resolves its target from `ctx.rexDir` — through
`resolveStore(ctx.rexDir)` in `routes-rex/items.ts`, `prune.ts`, `health.ts`,
`refinements.ts` (which is where the Ask panel's accepted proposals land, via
`POST /api/rex/apply-refinements`), `requirements.ts` and `routes-rex-analysis.ts`;
and by path in `restore.ts`, which restores from that workspace's `.rex/.backups`.
Since PR 12 that ctx is whichever workspace the request addressed —
the `/w/<key>/` slot or `X-Ndx-Workspace` — so a write made while viewing a branch
worktree rewrites **that worktree's** `.rex/prd_tree/` and leaves the anchor's
untouched. The PRD lock is per `rexDir` (`prdLockPath`), one per workspace: two
worktrees write concurrently without contending, and equally, the lock does not
serialize them against each other. Nothing needs it to — they are different trees.

Two rules follow, and both are load-bearing:

- **No cross-workspace write action.** No route takes a workspace as a parameter,
  and no UI offers "apply to the anchor instead". Editing the anchor's PRD while
  viewing a branch requires switching workspace through the breadcrumb switcher,
  which is a full navigation. A cross-workspace affordance would make the write
  target a thing the reader has to check rather than a thing the URL states.
- **The write target is stated, not inferred.** `WorkspaceWriteStrip`
  (`viewer/components/workspace-write-strip.ts`) renders a one-line strip in the
  PRD view for a non-anchor workspace only. On the anchor it renders nothing —
  a permanent banner on the common case is noise.

`tests/integration/workspace-scoped-prd-writes.test.ts` pins this by hashing both
trees around each write; a route that wrote both would fail it.

### The Workspaces board is the one cross-workspace reader

`viewer/views/workspaces.ts` is the exception to both rules above, deliberately
and in one direction only. It is *about* the set of worktrees, so it addresses
each one explicitly with the `X-Ndx-Workspace` header rather than the `/w/<key>/`
slot — the slot is already spent on whichever workspace the viewer itself is
mounted under, and the server reads the header ahead of the slot
(`workspaceFromHeader` in the dispatcher, not the lenient `resolveWorkspace`).
Three endpoints answer for the whole repository and are fetched plainly
(`/api/workspaces`, `/api/worktrees`, `/api/hench/memory`); the rest are per
workspace.

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

## hub zone (`src/hub/`)

`src/hub/` is the 0.7.0 hub daemon (`web hub`): one process per user that owns
`~/.n-dx/hub.json` (project registry) and `~/.n-dx/hub.pid`, serves `/api/hub/*`,
and runs one `web serve` child per registered repository on an ephemeral loopback
port. It is its own zone with a deliberately small import surface:

- node built-ins, `src/shared/` through its barrel (the base-path helpers the hub
  shares with the viewer), and `@n-dx/llm-client` exec helpers **only** through
  `src/hub/exec-gateway.ts` (re-export only, no logic).
- Nothing from `src/server/` or `src/viewer/`. The project servers it spawns are
  today's `web serve` unchanged; the hub talks to them over HTTP (`GET /api/status`),
  never by import. The two JSON response helpers in `hub/routes.ts` are local for
  that reason rather than shared with `server/response-utils.ts`.
- Consumers import from `src/hub/index.ts`, the barrel.

`$N_DX_HOME` overrides the `~/.n-dx` directory; tests pass `homeDir` explicitly.
Core's `web.js` spawns the hub (PR 10) — the orchestration tier still never imports it.

**Proxy and base path.** `hub/proxy.ts` forwards `/p/<id>/…` to that project's
server with the prefix stripped (HTTP streamed, WebSocket upgrades piped over
`node:net`), and aliases the root to the sole registered project; with several
registered, `/` is a project list and other root paths answer 409 with the ids.
The viewer derives the same prefix from `location.pathname` at boot
(`viewer/base-path.ts`): `installBasePathFetch()` prefixes every root-relative
`fetch`, `getWebSocketUrl()` is the one socket endpoint, and `appUrl()` covers
hand-built URLs (history entries, share links, the logo). Both sides use
`src/shared/base-path.ts`, so where the prefix ends is defined once. New viewer
code must not build `ws://…${location.host}` or `location.origin + "/api/…"` by
hand — go through those helpers.

**Workspace slot.** The viewer's base path also carries `/w/<key>` when it
addresses a worktree other than the anchor (`detectViewerBasePath`), so
`/p/app/w/feature/prd` and `/w/feature/prd` deep-link to that worktree's tree.
The project server strips the slot in `start.ts` before dispatch
(`stripWorkspaceSlot`), resolves the workspace in the registry, and answers an
unknown key with a 404 page linking to the anchor; `X-Ndx-Workspace` does the
same for non-browser clients. Routes never see the slot.
