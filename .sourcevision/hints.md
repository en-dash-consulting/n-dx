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
