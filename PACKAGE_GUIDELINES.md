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

## `.rex/` Write-Access Protocol

The `.rex/` directory is a **shared mutable data zone** — readable by rex, hench, and web without creating import-graph coupling. This is an intentional design: packages share state via filesystem rather than runtime imports. However, concurrent write safety depends on the following protocol.

**Markdown-primary PRD invariant.** `.rex/prd.md` is the canonical PRD document, and `.rex/prd.json` is a derived sync artifact dual-written on every save. There are no branch-scoped or multi-file writers in the current layout — every reader and writer (rex CLI, hench, MCP, web dashboard) observes the same pair of files. `FileStore.saveDocument()` writes `prd.json` first (atomic JSON) and then `prd.md` (atomic markdown via the rex/v1 serializer); `FileStore.loadDocument()` prefers `prd.md` when it exists and falls back to migrating `prd.json` on first read. A one-time on-load migration also consolidates any legacy `prd_{branch}_{date}.json` files into `prd.json` and renames the sources to `<name>.backup.<timestamp>`; no user action is required, and a manual migration is available via `rex migrate-to-md` if you need to generate `prd.md` ahead of the first read. `rex add` / `ndx add` therefore target the canonical pair unconditionally — any documentation or tooling that still references branch-scoped PRD targeting, or that treats `prd.json` as authoritative for edits, is stale and should be updated to point at `prd.md`.

### Write ownership

| File | Owner (writer) | Readers | Write pattern |
|---|---|---|---|
| `prd.md` | **rex** (FileStore) | hench, web | Atomic read-modify-write via `saveDocument()` (primary, dual-written alongside `prd.json`) |
| `prd.json` | **rex** (FileStore) | hench, web | Atomic read-modify-write via `saveDocument()` (derived sync artifact) |
| `config.json` | **rex** (FileStore) | hench, web | Written at init; updated via `rex config` |
| `execution-log.jsonl` | **rex** (FileStore) | web | Append-only via `appendLog()` |
| `workflow.md` | **rex** (FileStore) | web | Overwritten on status transitions |
| `pending-proposals.json` | **rex** (analyze) | web | Overwritten on each `rex analyze` run |
| `acknowledged-findings.json` | **rex** (analyze) | — | Overwritten on acknowledge |
| `archive.json` | **rex** (prune) | — | Overwritten on prune |

### Rules

1. **Single writer per file** — only the owning package writes to each file. Hench and web read `.rex/` files but never write to them; they modify PRD state by invoking rex APIs (CLI or library). In particular, no consumer may write `prd.md` or `prd.json` directly — both flow through `FileStore.saveDocument()` so the dual-write stays in lockstep.
2. **No file locking** — the current design assumes sequential access (one `ndx work` process at a time). The hench concurrency limiter enforces this at the process level.
3. **Append-only logs** — `execution-log.jsonl` uses `appendFile()`, which is atomic for small writes on local filesystems. Rotation is numeric-suffix-based (`.1.jsonl`).
4. **Graceful degradation** — readers (web, hench) treat missing or malformed `.rex/` files as non-fatal. The web cleanup scheduler skips its cycle if the PRD is unavailable; readers that still consume JSON directly should accept either `prd.md`-derived or `prd.json` sources and must not assume one without the other.
5. **Never write from the agent** — the hench agent prompt explicitly forbids direct modification of `.rex/` files. All PRD mutations go through rex's store layer, which guarantees the `prd.md` + `prd.json` dual-write.
