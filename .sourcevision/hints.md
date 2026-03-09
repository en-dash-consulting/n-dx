# SourceVision Zone Hints

## Web package viewer components

Files under `packages/web/src/viewer/` are all part of the web-dashboard viewer
application, regardless of subdirectory. Specifically:

- `packages/web/src/viewer/components/elapsed-time.ts` — viewer UI component
- `packages/web/src/viewer/components/prd-tree/lazy-children.ts` — viewer UI component
- `packages/web/src/viewer/components/prd-tree/listener-lifecycle.ts` — viewer UI component
- `packages/web/src/viewer/hooks/use-tick.ts` — viewer hook
- `packages/web/src/viewer/views/task-audit.ts` — viewer view
- `packages/web/src/viewer/route-state.ts` — route parsing and resolution

These should NOT be grouped with build infrastructure files (`build.js`, `dev.js`,
`package.json`, `tsconfig.json`). They are consumer-facing UI code that belongs in
the web-dashboard zone.

## Build scripts vs configuration

`packages/web/build.js` and `packages/web/dev.js` are executable build runner
scripts (entrypoints), not static configuration files.

## MCP Route Layer coupling

The bidirectional coupling between mcp-route-layer and web-dashboard is
architectural: routes-mcp.ts imports from rex-gateway.ts (runtime gateway) and
types.ts (shared server types), while start.ts in web-dashboard imports the MCP
route handler. The types.ts import is type-only (erased at compile time). This
coupling is inherent to the composition-root pattern where web-dashboard wires
together route handlers.

## Rex schema barrel (fan-in hotspot)

`packages/rex/src/schema/index.ts` has high fan-in by design. It is the single
public surface for rex's type definitions and domain constants. The stability
contract is documented in its docblock.

## Rex zone refactoring (notion-integration, remote-integration, etc.)

The Notion integration code is colocated in `packages/rex/src/store/`:
- `notion-map.ts` — bidirectional mapping between PRD items and Notion pages
- `notion-adapter.ts` — Notion database adapter implementing PRDStore
- `integration-schemas/notion.ts` — Notion schema definitions
These three files form a single "notion-integration" zone.

The remote-integration zone should focus on remote sync infrastructure:
- `store/adapter-registry.ts`, `store/integration-schema.ts`, `store/notion-client.ts`
- `core/dag.ts`, `core/canonical.ts`, `core/tree.ts` (when used for sync)
- Sync engine and conflict detection modules

Files like `core/move.ts`, `analyze/acknowledge.ts`, and `recommend/types.ts`
are PRD operations core — they serve the entire package, not just remote sync.

CLI commands `recommend.ts` and `sync.ts` are mutation commands (write operations),
not remote infrastructure. `report.ts` is a read-only status display command.

`constants.ts` is a foundation-level shared module with 7-zone fan-out — it
belongs in rex-runtime-data, not in any feature-specific zone.

## Hench store files

`packages/hench/src/store/suggestions.ts` and its test belong in the hench-agent
zone alongside the rest of the hench store layer (config.ts, runs.ts, json.ts,
etc.). They should NOT be grouped with web package files — the import graph
places them in a residual zone due to weak connectivity, but their domain purpose
is clearly hench agent infrastructure.

## Cross-package residual zone prohibition

The residual zone must never group files from different packages (e.g.
`packages/hench/` and `packages/web/`) under a single zone ID. If the Louvain
algorithm produces a residual community that spans package boundaries, each
package's files must be split into their own zone or merged into the
package-specific zone they most logically belong to. A cross-package residual
zone makes zone-level health metrics unreliable because hints or thresholds
applied to one package's files unintentionally affect the other package's files.

## Task usage analytics coupling

The bidirectional zone crossing between task-usage-analytics and web-dashboard is
dependency-injection based, not a true circular dependency. The cleanup scheduler
receives `collectAllIds` as a callback parameter rather than importing it directly
from rex-gateway. The shared-types.ts file serves as a zone-neutral type anchor.
This is intentional architecture.
