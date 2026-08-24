## Web package internal zone layering

Within the web package, four internal zones form a hub topology with `web-viewer` at the center:

```
  web-server          (composition root — Express routes, gateways, MCP handlers)
       ↓                    ↓ (serves static assets only, no runtime import)
  web-viewer          (Preact UI hub — components, hooks, views)
       ↑ ↓                  ↓
  viewer-message-pipeline  (messaging middleware — coalescer, throttle, rate-limiter, request-dedup)
       ↓                    ↓
  web-shared          (framework-agnostic utilities — data-files, node-culler, view-id)
```

`web-viewer` is the hub: it imports from `viewer-message-pipeline` (via `external.ts`) and `web-shared`, while also receiving imports from sub-zones like `crash/` and `hench-agent-monitor`. The actual import graph has 11+ distinct cross-zone edges radiating from `web-viewer`, making it a hub rather than a linear stack. `web-server` is a parallel composition root — it wires gateways and routes but does not import from `web-viewer` at runtime (the viewer is built separately and served as static assets). `web-shared` is the foundation layer with zero upward dependencies (enforced by `boundary-check.test.ts`).

See the root `CLAUDE.md`'s "Monorepo-wide zone fragility governance" section for the cohesion/coupling thresholds and universal governance rules referenced below.

## web-shared addition policy

`web-shared` has low cohesion (0.36) and high coupling (0.64). The zone contains 5 files (below the 5-file threshold for reliable metrics), so the measured values reflect the inherent low internal relationship between its modules (data-file constants, feature flags, view identifiers, routing helpers) rather than structural decay. Note: Louvain may merge this zone into `web-viewer` when shared imports create a strong bridge to viewer files — if that happens, pin the shared files back to `web-shared` on the next analysis. In addition to the universal governance rules:

- **Framework-agnostic only:** `web-shared` must not contain Preact/React imports or server-only (`node:*`) imports. If a utility needs framework APIs, it belongs in the consuming zone.
- **Barrel import enforcement:** Consumers must import through `shared/index.ts` rather than directly from leaf files (`data-files.ts`, `view-id.ts`). Enforced by `boundary-check.test.ts`.
- **Two-consumer rule (automated):** Every module in `shared/` must have at least two distinct consumer zones. Enforced by the "shared/ modules have at least two consumer zones" assertion in `boundary-check.test.ts`.

## crash zone proactive governance

`crash` (cohesion 0.5, unidirectional coupling: web-viewer → crash) sits at the dual-fragility threshold boundary. Crash imports web-shared directly (documented bypass) rather than web-viewer. Apply the two-consumer rule proactively to new crash zone additions before cohesion degrades further.

## viewer-ui-hub governance

`viewer-ui-hub` (cohesion 0.38, coupling 0.63) is the intentional Preact UI composition hub — it assembles sidebar, config-footer, faq, and logos components. Its dual-fragility metrics are **structurally expected** for a UI composition root: it imports broadly from `web-viewer` (high coupling) while its internal files serve distinct UI concerns (low cohesion). In addition to the universal governance rules:

- **No domain logic:** This zone must contain only UI composition components and their direct rendering helpers. Data fetching and state management belong in hooks or views.
- **Monitor fan-out:** The bidirectional 74-edge coupling with the web dashboard platform zone is the largest cross-zone relationship in the web package — audit import direction periodically to ensure inbound imports enter through `api.ts` or composition-root wiring rather than ad-hoc leaf reach-ins.
- **Satellite consolidation:** Three micro-zones (theme-toggle, search-overlay, graph-view-tests) are community-detection artifacts pointing at this hub — consolidating them reduces zone noise without losing architectural boundaries.

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

**General rule for HTTP:** The web server treats disk files as read-only and never holds write locks. The folder tree watcher refreshes `.rex/.cache/prd.json` automatically for most PRD mutations. Any command that bulk-rewrites `.sourcevision/` (ci, refresh) should be followed by a server restart to flush stale caches.
