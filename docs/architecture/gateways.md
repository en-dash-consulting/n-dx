# Gateway Modules

When a package imports from another package at runtime, all imports are concentrated into a single **gateway module**. This makes the cross-package dependency surface explicit, auditable, and easy to update.

## Current Gateways

| Package | Gateway file | Imports from | Purpose |
|---------|-------------|--------------|---------|
| hench | `src/prd/rex-gateway.ts` | rex | Store access, tree traversal, task selection, timestamps, auto-completion, finding acknowledgment |
| hench | `src/prd/llm-gateway.ts` | @n-dx/llm-client | Config, constants, JSON parsing, output formatting, process execution, token parsing, model resolution |
| web | `src/server/rex-gateway.ts` | rex | Rex MCP server factory, domain types & constants, tree utilities |
| web | `src/server/domain-gateway.ts` | sourcevision | Sourcevision MCP server factory |
| web | `src/viewer/external.ts` | messaging, shared, schema | Viewer-to-server boundary gateway |

## Rules

1. **One gateway per source package** — all runtime imports from a given upstream package pass through a single gateway. A consumer may have multiple gateways for different upstream packages.

2. **Re-export only** — gateways re-export; they contain no logic. Enforced by `domain-isolation.test.js`.

3. **Type imports through gateway** — `import type` must also flow through gateways to prevent type-import promotion erosion (a type import can be silently promoted to a runtime import during refactoring). Exception: web viewer files are exempt because the server/viewer boundary prevents them from reaching the server-side gateway.

4. **Messaging exemption** — `src/viewer/messaging/` files may import directly from `src/shared/` without going through `external.ts`. Enforced by `boundary-check.test.ts`.

5. **New cross-package imports** require a deliberate edit to the gateway, not a casual import in a leaf file.

## Intra-Package Gateways

Within the web package, `src/viewer/external.ts` concentrates all viewer-side imports from `src/viewer/messaging/`, `src/shared/`, and `src/schema/`. `RequestDedup` is canonically located in `src/viewer/messaging/request-dedup.ts` and re-exported through `external.ts` for viewer consumers.

## Injection Seams

Some cross-zone dependencies use callback injection rather than gateway imports. These seams are invisible to static analysis:

| Injection site | Target module | Injected callbacks | Interface type |
|----------------|---------------|--------------------|----------------|
| `web/src/server/start.ts` | `web/src/server/register-scheduler.ts` | `broadcast`, `collectAllIds`, `loadPRD`, `getAggregator` | `RegisterSchedulerOptions` |

**Rules:**
- Prefer injection over import when the target would otherwise need to import from a higher-tier zone
- Every injection seam must have a named TypeScript interface
- New seams require an entry in this table

## Gateway JSDoc Template

```typescript
/**
 * Centralized gateway for <source-package> runtime imports.
 *
 * <Brief description of why this package needs runtime imports.>
 *
 * By concentrating all <pkg>→<source> runtime imports here, we ensure:
 * - The cross-package surface is **explicit** (N re-exports, not M scattered imports).
 * - The DAG stays **acyclic**.
 * - Future changes to <source>'s public API need only be updated in this single file.
 *
 * @module <pkg>/<gateway-path>
 * @see <path-to-sibling-gateway> — <sibling>'s equivalent gateway
 */
```

## Testing

Every gateway must have integration tests verifying:

1. **Re-export existence** — every symbol is callable/constructible
2. **Contract correctness** — at least one end-to-end scenario through the gateway
3. **Type alignment** — type re-exports match upstream public API
