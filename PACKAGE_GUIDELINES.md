# Package Development Guidelines

Standards for creating and maintaining packages in the n-dx monorepo. These patterns emerged organically and are now codified to prevent drift and reduce onboarding friction.

## Public API (`src/public.ts`)

Every package exposes its public surface through `src/public.ts`, mapped to `exports["."]` in `package.json`:

```json
{
  "exports": {
    ".": {
      "import": "./dist/public.js",
      "types": "./dist/public.d.ts"
    },
    "./dist/*": "./dist/*"
  }
}
```

### What to export

Each package's public API reflects how it is **consumed**, not what it contains:

| Consumption pattern | Export style | Example |
|---|---|---|
| Library (runtime imports) | Functions + types | rex: `resolveStore`, `findNextTask`, etc. |
| MCP server + filesystem reads | MCP factory + schema types | sourcevision: `createSourcevisionMcpServer`, `Manifest`, etc. |
| CLI + filesystem reads | Types + schema constants + config factory | hench: `HenchConfig`, `RunRecord`, `DEFAULT_HENCH_CONFIG` |
| Coordination facade | Server entry + server types | web: `startServer`, `ServerOptions` |

**Decision tree** — when adding a new export, ask:

1. Will another package call this function at runtime? → Export it.
2. Will another package read a JSON file with this shape? → Export the type.
3. Is it only used internally (CLI commands, init defaults, validation schemas)? → Keep it internal.

### What NOT to export

- **Default config factories** — Rex exports `DEFAULT_CONFIG(project)` and hench exports `DEFAULT_HENCH_CONFIG()` from their public APIs for external tooling. Sourcevision has no persistent config. Config factories that require complex initialization context beyond simple parameters remain internal.
- **Zod validation schemas** — Exporting them forces Zod as a transitive dependency on type-only consumers. Packages that need runtime validation import directly from `dist/schema/validate.js`.
- **Internal utilities** — Helper functions that serve a single consumer within the package.

### JSDoc header

Every `public.ts` starts with a module-level JSDoc comment documenting:

1. **API philosophy** — one-line summary of the export style and why
2. **Consumption pattern** — how other packages interact with this one
3. **Architectural isolation** — where this package sits in the dependency DAG
4. **Configuration note** — whether config is exported and why/why not

## Gateway Modules

When a package imports from another package at runtime, those imports are concentrated into a **single gateway module**. This makes the cross-package dependency surface explicit, auditable, and easy to update.

### Current gateways

| Package | Gateway | Source packages | Purpose |
|---|---|---|---|
| hench | `src/prd/rex-gateway.ts` | rex | Store access, tree traversal, task selection |
| web | `src/server/rex-gateway.ts` | rex | Rex MCP server factory, domain types & constants, tree utilities |
| web | `src/server/domain-gateway.ts` | sourcevision | Sourcevision MCP server factory |

### Gateway rules

1. **One gateway per source package** — all runtime imports from a given upstream package pass through a single gateway. A consumer may have multiple gateways when it imports from multiple upstream packages (e.g. web has separate gateways for rex and sourcevision).
2. **Re-export only** — gateways re-export symbols; they contain no business logic.
3. **Type imports excluded** — `import type` is erased at compile time and creates zero runtime coupling. Type imports stay at the call-site.
4. **Deliberate friction** — adding a new cross-package import requires editing the gateway, not sprinkling `import … from "rex"` in a leaf file.
5. **Cross-reference** — each gateway's JSDoc links to its sibling gateways with `@see`.

### Gateway JSDoc template

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

## Type Duplication Strategy

Sometimes a package needs types from another package but importing them would create unwanted build-time coupling. In these cases, types are **duplicated** with compile-time consistency tests.

### Current instances

| Consumer | Source | Duplicated types | Consistency test |
|---|---|---|---|
| web viewer (`prd-tree/types.ts`) | rex | `ItemLevel`, `ItemStatus`, `Priority`, `PRDItemData`, etc. | `tests/unit/server/type-consistency.test.ts` |
| web viewer (`views/analysis.ts`) | rex | `LogEntry` (local interface) | — |

Server-side rex types were previously duplicated in `rex-domain.ts` but are now
imported from rex through the gateway (`domain-gateway.ts`). Only viewer types remain
as intentional duplicates because browser-bundled code cannot import Node.js packages.

### When to duplicate vs. import

- **Import** when the packages already have a runtime dependency (hench → rex, web → rex).
- **Duplicate** only when the consumer runs in the browser and cannot import Node.js packages (web viewer).
- **Always** add a compile-time test that verifies the duplicate stays in sync.

## Package.json Standards

### Required scripts

Every package must include these scripts:

| Script | Command | Purpose |
|---|---|---|
| `build` | `tsc` (or `tsc && node build.js`) | Compile TypeScript |
| `dev` | `tsc --watch` | Watch mode for development |
| `typecheck` | `tsc --noEmit` | Type checking without emit |
| `test` | `vitest run` | Run tests once |
| `test:watch` | `vitest` | Watch mode for tests |
| `validate` | `tsc --noEmit && vitest run` | Full validation (CI uses this) |
| `prepare` | `npm run build` | Build on install |

### Exports

All packages must include the subpath export for advanced consumers:

```json
{
  "exports": {
    ".": { "import": "./dist/public.js", "types": "./dist/public.d.ts" },
    "./dist/*": "./dist/*"
  }
}
```

### Naming

| Pattern | When | Examples |
|---|---|---|
| Unscoped short name | CLI tools (for `npx`/`pnpm exec`) | `rex`, `sourcevision`, `hench` |
| `@n-dx/` scoped | Internal-only packages | `@n-dx/web`, `@n-dx/llm-client` |

## Test Structure

```
tests/
  unit/          # Pure function tests, no I/O
  integration/   # Tests with filesystem or subprocess interaction
  e2e/           # End-to-end CLI tests
```

All test files use `*.test.ts` suffix. Tests are co-located with the code they test by directory structure (e.g., `tests/unit/core/tree.test.ts` tests `src/core/tree.ts`).

## Dependency Hierarchy

```
  Orchestration   cli.js, web.js, ci.js        (spawns CLIs, no library imports)
       ↓
  Coordination    @n-dx/web                    (reads domain data, hosts MCP)
       ↓
  Execution       hench                        (agent loops → imports rex via gateway)
       ↓
  Domain          rex · sourcevision           (independent, never import each other)
       ↓
  Foundation      @n-dx/llm-client             (shared types, API client)
```

**Rules:**
- Each layer imports only from the layer below (or same layer for web → domain).
- Domain packages never import each other.
- Orchestration scripts spawn CLIs via `execFile`; they never import packages directly.
- The web package is an exception: it sits at coordination level, importing domain packages through its gateway for MCP servers, and reading domain data from the filesystem for everything else.
