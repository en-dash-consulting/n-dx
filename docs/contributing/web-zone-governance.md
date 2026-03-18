# Web Package Zone Architecture

Architectural documentation for the zone topology within `packages/web`, clarifying zone roles, import relationships, and naming conventions.

## Zone Topology

The web package decomposes into several zones detected by sourcevision's community detection (Louvain algorithm). The zones form a layered structure:

```
  web-viewer (hub, ~329 files)
       |
       +--> viewer-call-rate-limiter   (rate limiting + request dedup tests)
       +--> viewer-message-flow-control (coalescing + throttling primitives)
       +--> web-package-scaffolding     (build tooling, config, shared utils)
       +--> dom-performance-monitoring  (DOM perf monitor + hook)
```

## The "web-integration" Zone Alias

### What it is

In sourcevision's import graph, the alias `web-integration` maps to the **viewer-call-rate-limiter** zone. This zone contains:

| File | Role |
|------|------|
| `src/viewer/messaging/call-rate-limiter.ts` | Rate-limits outbound API calls |
| `tests/integration/request-dedup.test.ts` | Integration test for request dedup |
| `tests/unit/viewer/call-rate-limiter.test.ts` | Unit tests for the rate limiter |

### What it is NOT

Despite its name, `web-integration` is **not** a facade or adapter layer. It does not mediate between `web-viewer` and lower zones. Specifically:

- `web-viewer` imports `viewer-message-flow-control` (message zone) **directly** for coalescing and throttling — it does not route through `web-integration`.
- `web-viewer` imports `web-package-scaffolding` **directly** for shared utilities — again, not through `web-integration`.
- `web-integration` imports from both `viewer-message-flow-control` and `web-package-scaffolding`, but only from its test files, not as a forwarding layer.

### Actual role: parallel consumer

`web-integration` is a **parallel consumer** of the messaging primitives, sitting alongside `web-viewer` rather than in front of it:

```
  web-viewer -----> viewer-message-flow-control  (direct, 4 imports)
       |                     ^
       |                     |
       +---> web-integration-+  (parallel, 2 imports from tests)
```

Both `web-viewer` and `web-integration` independently consume the messaging zone. Neither routes through the other.

### Why the name is misleading

The alias `web-integration` was assigned by sourcevision's zone enrichment based on the presence of `tests/integration/` files in the zone. Contributors may interpret "integration" as "architectural integration layer" (i.e., a facade that bridges web-viewer to lower zones), but the zone's actual purpose is narrower: it houses the call-rate-limiter and its cross-cutting integration tests.

### Guidelines for contributors

1. **Do not add facade/adapter logic to this zone.** It is not an integration layer — it is a rate-limiting utility with associated tests.
2. **Use the messaging barrel** (`src/viewer/messaging/index.ts`) as the stable import surface for all messaging utilities. The barrel exports both composed pipelines (`WSPipeline`, `FetchPipeline`) and individual primitives.
3. **New integration tests** that exercise multiple messaging primitives together belong in `tests/integration/`, which is part of this zone. This is the correct and intended use of the zone.
4. **Cross-zone imports** from `web-viewer` into messaging should go through the messaging barrel, not through individual implementation files. See the [messaging zone public interface](../packages/web/src/viewer/messaging/index.ts) for the full export surface.

## Messaging Zone Stack

The messaging subsystem spans three zones with distinct responsibilities:

| Zone | Alias | Responsibility | Key exports |
|------|-------|---------------|-------------|
| viewer-message-flow-control | `message` | Coalescing + throttling primitives | `MessageCoalescer`, `MessageThrottle` |
| viewer-call-rate-limiter | `web-integration` | Rate limiting + dedup | `CallRateLimiter` |
| web-package-scaffolding | `web` | Shared utils (request-dedup, node-culler) | `RequestDedup` |

All three are re-exported through the messaging barrel (`src/viewer/messaging/index.ts`), which provides composed pipelines (`WSPipeline`, `FetchPipeline`) as the preferred consumer API.

## Web Dashboard Zone Content Contract

The `web-dashboard-mcp-server` zone (329 files) is the hub zone for the web package. Its name reflects the MCP server entry point, but its actual scope is broader — it contains the full-stack dashboard application.

### What belongs here

| Content type | Examples |
|-------------|----------|
| Server routes | `src/server/routes-*.ts` |
| Server infrastructure | `start.ts`, `websocket.ts`, `search-index.ts` |
| Viewer components | `src/viewer/components/**/*.ts` |
| Viewer hooks | `src/viewer/hooks/**/*.ts` |
| Viewer state | `src/viewer/polling/**/*.ts`, `src/viewer/state/**/*.ts` |
| Shared schema | `src/schema/v1.ts` |
| Package entry | `src/public.ts`, `src/cli/index.ts` |
| Unit + integration tests | `tests/unit/viewer/**/*.ts`, `tests/integration/**/*.ts` |

### What does NOT belong here

| Content type | Correct zone |
|-------------|-------------|
| Static assets (HTML, CSS, images) | `viewer-static-assets`, `landing-page` |
| Messaging primitives (coalescer, throttle) | `viewer-message-flow-control` |
| Rate limiting utilities | `viewer-call-rate-limiter` |
| Build config, package metadata | `web-package-scaffolding` |
| DOM performance monitors | `dom-performance-monitoring` |
| Lifecycle components with sparse imports | `prd-tree-lifecycle` |

### Cohesion monitoring

Current cohesion is 0.99 (healthy). The primary risk is the server/client co-location: server-side services and viewer UI components share a zone boundary. No zone-level coupling metric will catch a server-to-client import violation because they are in the same zone. Contributors should:

1. Keep server imports in `src/server/` files only
2. Keep viewer imports in `src/viewer/` files only
3. Use `src/shared/` for code genuinely needed by both

## Related Decisions

- **Messaging barrel**: Created as part of the "Create messaging zone public interface" task. See `packages/web/src/viewer/messaging/index.ts`.
- **Gateway pattern**: Cross-package imports use gateway modules (see `PACKAGE_GUIDELINES.md`). Intra-package zone boundaries use barrel exports instead.
- **Viewer architecture**: See `docs/viewer-architecture.md` for the package-level composition model.
