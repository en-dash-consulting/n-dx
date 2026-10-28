# Package Development Guidelines

> **Canonical.** A condensed version of this page is published at
> [`docs/contributing/package-guidelines.md`](docs/contributing/package-guidelines.md)
> for the docs site. Make changes here first.

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
6. **CI-enforced** — `ndx ci` runs a gateway import boundary check that fails the build if any cross-package runtime import bypasses the designated gateway. See the `checkGatewayImports` function in `ci.js`.

### Import boundary rules (CI-enforced)

In addition to the gateway pattern, CI enforces intra-package import direction:

| Rule | Scope | Rationale |
|---|---|---|
| `server/` cannot import `viewer/` | `packages/web/src/server/` | Server runs in Node.js; viewer code is browser-only |

These rules are defined in `ci.js` (`GATEWAY_RULES` and `BOUNDARY_RULES` arrays) and checked on every CI run. Violations fail the build.

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

### The `dist/*` wildcard export (intentional escape hatch)

Every package includes `"./dist/*": "./dist/*"` in its `exports` field. This is
an **intentional escape hatch** for advanced consumers and cross-package
integration tests that need access to internal modules not exposed through
`public.ts`.

**Stability disclaimer:** Files imported through `dist/*` are **not part of the
public API**. They may be renamed, moved, or deleted without notice. Consumers
that bypass `public.ts` accept the risk of breakage on any update.

**Acceptable uses:**

| Use case | Example |
|----------|---------|
| Integration tests importing built artifacts | `import { collectAllIds } from "rex/dist/core/tree.js"` |
| CI scripts validating internal structure | `import { GATEWAY_RULES } from "web/dist/server/constants.js"` |
| Temporary access during gateway migration | Importing a symbol before it's added to the gateway |

**Prohibited uses:**

- Production runtime imports that bypass the gateway (use the gateway instead)
- Importing internal types when a `public.ts` type export exists
- Treating `dist/*` imports as stable API — they are not

If a `dist/*` import persists beyond a single PR, it should be promoted to the
gateway or `public.ts`, or the import should be removed.

### Naming

All eight packages are published under the `@n-dx/` scope:

| Package name | Bin aliases |
|---|---|
| `@n-dx/core` | `n-dx`, `ndx` |
| `@n-dx/rex` | `rex` |
| `@n-dx/sourcevision` | `sourcevision`, `sv` |
| `@n-dx/hench` | `hench` |
| `@n-dx/llm-client` | _(library only)_ |
| `@n-dx/web` | _(library only)_ |
| `@n-dx/graview` | `ndx-graview` (spawned by `ndx graview`) |
| `@n-dx/graview-face` | `ndx-graview-face` (the product's dev server; run by `ndx graview serve`) |

The bare `rex` / `sourcevision` / `sv` / `hench` names are **bin aliases declared in
`package.json`**, not package names — they exist so the CLIs can be invoked directly
once installed. `npx rex` would resolve to an unrelated package on the public
registry; use `npx -p @n-dx/core ndx` instead.

## Test Structure

```
tests/
  unit/          # Pure function tests, no I/O
  integration/   # Tests with filesystem or subprocess interaction
  e2e/           # End-to-end CLI tests
```

All test files use `*.test.ts` suffix. Tests are co-located with the code they test by directory structure (e.g., `tests/unit/core/tree.test.ts` tests `src/core/tree.ts`).

### Utility + Hook testing convention

When a feature is implemented as a standalone utility module with a framework hook wrapper (the "utility + hook" pattern), **both layers must have dedicated tests**:

| Layer | File pattern | Test focus |
|---|---|---|
| Utility | `<feature>.test.ts` | Pure logic: data structures, ring buffers, computations, module lifecycle (start/stop/reset). No framework dependency. |
| Hook | `use-<feature>.test.ts` | Framework integration: mount starts the service, unmount cleans up, prop/ref changes trigger re-subscription, wrapped callbacks delegate correctly. |

**Why two files:**
- The utility test runs without jsdom — faster, simpler assertions, easier to debug.
- The hook test validates the Preact lifecycle contract (effect scheduling, ref timing, state updates) which is orthogonal to the utility logic.
- Keeping them separate prevents a failing framework test from masking a utility regression (and vice versa).

**Hook test conventions (Preact + vitest):**
- Use `// @vitest-environment jsdom` at the top of the file.
- Import `act` from `preact/test-utils` to flush deferred effects.
- With `vi.useFakeTimers()`, wrap render calls in `act(() => { render(...); vi.advanceTimersByTime(0); })` to flush Preact's deferred `useEffect` scheduling.
- Test module-level state (e.g., `getLatestDOMSnapshot()`) for lifecycle verification — this avoids brittleness from Preact's async state update batching.
- Use baseline-relative assertions for snapshot counts (`const baseline = getHistory().length; ... expect(getHistory().length).toBeGreaterThan(baseline)`) rather than exact counts, since Preact's effect re-run on ref attachment can produce an extra startup cycle.

**Current instances:**

| Feature | Utility test | Hook test |
|---|---|---|
| DOM performance monitoring | `dom-performance-monitor.test.ts` | `use-dom-performance-monitor.test.ts` |
| Polling suspension | `polling-state.test.ts` | `use-polling-suspension.test.ts` |

**Rule:** Every new `use-*.ts` hook wrapper must have a corresponding `use-*.test.ts` alongside the utility's test file. PRs that add a hook without a hook test are incomplete.

## Zone Structure

SourceVision zones are auto-detected by Louvain community detection. These conventions guide naming and structural expectations.

### Naming convention

All zones within a package share a consistent kebab-case prefix matching the package name:

| Package | Zone prefix | Examples |
|---|---|---|
| rex | `packages-rex-` | `packages-rex-core`, `packages-rex-cli`, `packages-rex-store` |
| sourcevision | `packages-sourcevision-` | `packages-sourcevision-analyzers`, `packages-sourcevision-cli` |
| web | `web-` | `web-viewer`, `web-server` |
| hench | `hench` | `hench` (single zone) |

Zone IDs that don't follow this convention (e.g., `panel`, `dom`, `logo` for web package files) indicate the Louvain algorithm found a community whose dominant directory segment differs from the package name. This is acceptable when the community has strong internal cohesion (>0.8) but should be reviewed when cohesion is low.

### Zone size budget

| Range | Status |
|---|---|
| 3-30 files | Target range |
| 31-50 files | Acceptable, monitor cohesion |
| 50+ files | Flagged for review — likely too broad, consider subdivision |
| <3 files | Satellite — auto-merged into most-connected neighbor by the pipeline |

### Satellite zone policy

Small zones (≤8 files) with coupling ratio >0.3 are automatically absorbed into their most-connected neighbor community during the Louvain post-processing step (`mergeSatelliteCommunities`). This prevents fragmentation of cohesive code into tiny, highly-coupled satellites.

Satellite zones that survive the merge (because they have strong internal cohesion) should own both their source files and corresponding unit tests within the same zone boundary.

### Test format

| Scope | Format | Example |
|---|---|---|
| Monorepo-root e2e tests | Plain `.js` (no build step) | `tests/e2e/cli-smoke.js` |
| Package-internal tests | `.ts` (compiled with package) | `packages/rex/tests/unit/core/tree.test.ts` |

**Why root e2e tests use `.js`:** These tests spawn compiled `dist/` binaries as child processes — they have zero source-level imports from any package. Plain JS avoids requiring a compile step for the tests themselves. However, they have a hidden **build-time dependency** on all packages: if any package fails to compile, e2e tests silently produce false-negatives. The `tests/e2e/verify-build.js` globalSetup script (wired into `vitest.config.js`) enforces this by failing fast if required `dist/` artifacts are missing.

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

## Rex Write-Access Protocol

The resolved rex directory (`.ndx/rex/` or legacy `.rex/`) is a shared mutable
data zone. Rex owns writes; hench and web read it and invoke rex APIs for
mutations. Sharing files does not create an import-graph edge, but write
safety still depends on the following protocol.

**PRD invariant.** On v2 the writable roots are `product/` and `changes/`.
Markdown holds intent; the containing folder's committed `state.yaml` holds
tool state. Changes always have folders with `index.md`; other nodes are
folders with children and `<slug>.md` leaves otherwise. Subtasks are nodes,
not body sections. On v1, the backend remains `prd_tree/` until migration.

`prd.md`, `prd.json` and branch-scoped `prd_*.md` are legacy migration
representations. Ordinary mutations never write them. Explicit legacy
conversion commands remain the migration exception. A JSON export bundle
is transport outside the resolved rex directory, never a PRD backend.

`.rex/.cache/prd.json` is an **ephemeral derived artifact**, generated only while `ndx start` is running and refreshed by the server's tree watcher. It is not PRD state: no code outside the web server may read it, and nothing may write it as a way of mutating the PRD.

See [`docs/architecture/prd-folder-tree-schema.md`](docs/architecture/prd-folder-tree-schema.md) for the naming convention, field schema, and serializer/parser contracts.

### Write ownership

| Path | Owner (writer) | Readers | Write pattern |
|---|---|---|---|
| `product/**`, `changes/**` | **rex** (v2 model/store) | hench, web | `withPrdModelTransaction` or the resolved store's `withTransaction`; one PRD lock spans both layers |
| `prd_tree/**` | **rex** (v1 FolderTreeStore) | hench, web | `withTransaction` holds the lock across read-modify-write; `saveDocument` alone locks only the save |
| `config.json` | **rex** (FileStore) | hench, web | Written at init; updated via `rex config` |
| `execution-log.jsonl` | **rex** (FileStore) | web | Append-only via `appendLog()`; rotates to `.1.jsonl` at 1 MB |
| `workflow.md` | **rex** (FileStore) | web | Overwritten on status transitions |
| `pending-proposals.json` | **rex** (analyze) | web | Overwritten on each `rex analyze` run |
| `acknowledged-findings.json` | **rex** (analyze) | — | Overwritten on acknowledge |
| `archive.json` | **rex** (prune, reshape) | — | Appended per batch, trimmed to the last 100 |
| `.cache/prd.json` | **web** (server) | web | Ephemeral; rebuilt from the tree, removed on shutdown |

### Rules

1. **Single writer per file** — consumers mutate PRD intent and state through rex's store/API, not direct filesystem writes. Human intent edits remain supported; tools own `state.yaml`.
2. **Lock the full mutation** — v2 uses `withPrdModelTransaction`; store clients use `withTransaction`. A refused lock names its holder. The lock is per rex directory, so separate worktrees have separate locks. On v1, snapshot-based CLI paths can still lose updates when only their final save is locked. Keep writer commands sequential; see [PRD write concurrency](docs/architecture/prd-write-concurrency.md).
3. **Append-only logs** — `execution-log.jsonl` uses `appendFile()`, which is atomic for small writes on local filesystems. Rotation is numeric-suffix-based (`.1.jsonl`).
4. **Graceful degradation** — readers (web, hench) treat missing or malformed `.rex/` files as non-fatal. The web cleanup scheduler skips its cycle if the PRD is unavailable.
5. **Never write from the agent** — the hench agent prompt explicitly forbids direct modification of `.rex/` files. All PRD mutations go through rex's store layer.
