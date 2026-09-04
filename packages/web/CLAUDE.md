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

## HTTP-request concurrency (web server)

When `ndx start` is running, the web server holds in-process caches (aggregation cache, PRD tree snapshot) that are populated from disk on demand. External CLI commands that write to the same files can cause stale or partial reads:

| Scenario | Risk | Mitigation |
|----------|------|------------|
| Dashboard reads PRD while `ndx plan` writes to `.rex/prd_tree/` | Partial aggregate read or stale derived JSON | Restart server after plan (`ndx start stop && ndx start`) |
| MCP request during `ndx work` PRD update | Momentarily stale status — hench writes are small atomic updates | Acceptable — dashboard polls and self-corrects within seconds |
| Concurrent dashboard API requests | Safe — Express serializes requests per-connection; no shared mutable state between request handlers | No action needed |

**General rule for HTTP:** most routes treat disk files as read-only. The exception is the PRD: the routes that mutate `.rex/prd_tree/` (item CRUD, merge, prune, reorganize, restore, and the Ask panel's `apply-refinements`) go through `rex-gateway`'s `resolveStore` and hold the PRD file lock for the span of `withTransaction`. That makes the server a first-class PRD writer alongside `ndx work` and the MCP tools, and it is why those routes surface a lock-acquisition failure — which names the holder's PID — rather than retrying or writing anyway.

The folder tree watcher refreshes `.rex/.cache/prd.json` automatically for most PRD mutations; routes that write also call `refreshPRDCache` so their own change is visible to the next read without a restart. Any command that bulk-rewrites `.sourcevision/` (ci, refresh) should be followed by a server restart to flush stale caches.
