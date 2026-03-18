# Viewer Code Audit

Inventory of all viewer-related code, cross-package dependencies, and placement recommendation.

## File Inventory

### Server Code (11 files, 3,124 lines)

All in `packages/sourcevision/src/cli/server/`:

| File | Lines | Purpose | Sourcevision-specific? |
|------|------:|---------|----------------------|
| `start.ts` | 184 | HTTP server bootstrap, file watchers, route dispatch | **No** — wires sv + rex + hench routes |
| `types.ts` | 57 | ServerContext, RouteHandler, json/error helpers | **No** — generic server utilities |
| `routes-sourcevision.ts` | 166 | `/api/sv/*` endpoints (manifest, inventory, imports, zones, components, context) | **Yes** |
| `routes-rex.ts` | 999 | `/api/rex/*` endpoints (PRD CRUD, dashboard, analyze, proposals, bulk ops) | **No** — rex domain |
| `routes-hench.ts` | 141 | `/api/hench/*` endpoints (run list, run detail) | **No** — hench domain |
| `routes-validation.ts` | 556 | `/api/rex/validate`, `/api/rex/dependency-graph` | **No** — rex domain |
| `routes-token-usage.ts` | 471 | `/api/token/*` endpoints (usage analytics) | **No** — cross-cutting |
| `routes-data.ts` | 140 | `/data/*` file serving + live-reload status polling | Partially — reads `.sourcevision/` JSON files |
| `routes-static.ts` | 116 | Serves viewer HTML + PNG assets | **No** — generic static file serving |
| `websocket.ts` | 274 | RFC 6455 implementation (no deps), broadcasts sv/rex/hench changes | **No** — generic infrastructure |
| `index.ts` | 20 | Re-exports `startServer` | **No** |

**Only 1 of 11 server files is sourcevision-specific** (`routes-sourcevision.ts`).

### Viewer Client Code (57 files, 11,435 lines TypeScript)

All in `packages/sourcevision/src/viewer/`:

#### Core (5 files)
| File | Purpose | SV-specific? |
|------|---------|-------------|
| `main.ts` | Preact app entry, view routing | **No** — orchestrates all views |
| `types.ts` | LoadedData, ViewId, DetailItem types | Partially — LoadedData types reference SV schema |
| `loader.ts` | Data loading (server vs static mode), polling | Partially — loads `.sourcevision/` data |
| `schema-compat.ts` | Schema version migration | **Yes** |
| `utils.ts` | Utility functions | Partially — uses SV Zones type |

#### Views (14 files)

| File | Domain | SV-specific? |
|------|--------|-------------|
| `views/overview.ts` | Dashboard summary | Partially — shows SV + rex data |
| `views/graph.ts` | Import dependency graph (D3) | **Yes** |
| `views/zones.ts` | Architectural zone map | **Yes** |
| `views/files.ts` | File inventory listing | **Yes** |
| `views/routes.ts` | Route detection/display | **Yes** |
| `views/architecture.ts` | Architecture analysis | **Yes** |
| `views/problems.ts` | Analysis findings/problems | **Yes** |
| `views/suggestions.ts` | Analysis suggestions | **Yes** |
| `views/prd.ts` | PRD tree (CRUD) | **No** — rex domain |
| `views/rex-dashboard.ts` | Rex dashboard (stats, progress) | **No** — rex domain |
| `views/analysis.ts` | Rex analysis log | **No** — rex domain |
| `views/validation.ts` | Validation + dependency graph | **No** — rex domain |
| `views/token-usage.ts` | Token usage analytics | **No** — cross-cutting |
| `views/hench-runs.ts` | Agent run history | **No** — hench domain |

**7 of 14 views are sourcevision-specific**, 5 are rex, 1 is hench, 1 is cross-cutting.

#### Components (24 files)

| File | Domain |
|------|--------|
| `components/sidebar.ts` | **Shared** — nav for all views, imports SV Manifest/Zones types |
| `components/detail-panel.ts` | **SV-specific** — file/zone detail display |
| `components/guide.ts` | **Shared** |
| `components/theme-toggle.ts` | **Shared** |
| `components/search-filter.ts` | **Shared** |
| `components/logos.ts` | **Shared** |
| `components/rex-task-link.ts` | **Rex domain** — task status badges, context menu for status change |
| `components/faq.ts` | **Shared** |
| `components/constants.ts` | **Shared** |
| `components/prd-tree/` (10 files) | **Rex domain** — full PRD tree management UI |
| `components/data-display/` (6 files) | **Shared/SV** — zone-map is SV-specific, rest are generic |
| `graph/physics.ts` | **SV-specific** — D3 force simulation |
| `graph/renderer.ts` | **SV-specific** — graph rendering |

#### Styles (25 CSS files, 6,721 lines)

All in `src/viewer/styles/`. Mix of generic layout/theming and domain-specific views:

- **Generic (10):** base, tokens, layout, forms, cards, tables, utils, responsive, a11y, branding
- **SV-specific (4):** graph, zone-map, overview (mixed), components
- **Rex domain (3):** prd-tree, rex-dashboard, task-link
- **Hench domain (1):** hench-runs
- **Cross-cutting (4):** analysis, token-usage, validation, detail
- **Structural (1):** index (imports all others)
- **Other (2):** routes, faq

#### Static Assets (3 files)
- `index.html` — root HTML template
- `lightmode_logo.png`, `darkmode_logo.png` — SV logos

### Test Files (17 files)

| Directory | Files | Domain |
|-----------|-------|--------|
| `tests/unit/server/` | 7 | Server routes, websocket, type consistency |
| `tests/unit/viewer/` | 10 | UI components and views |

### Build & Dev Files (2 files)

| File | Purpose |
|------|---------|
| `build.js` | esbuild bundler (inlines JS+CSS into single HTML) |
| `dev.js` | Dev server (tsc watcher + esbuild watcher + serve) |

### Root Orchestration (1 file)

| File | Purpose |
|------|---------|
| `web.js` | `ndx web` command — spawns `sourcevision serve`, PID management, port config |

## Cross-Package Dependencies

### Compile-Time Dependencies

The viewer and server code have **zero compile-time imports** of rex or hench packages.

**Sourcevision schema imports** (the only compile-time coupling):
- `src/schema/v1.ts` — Types: `Manifest`, `Inventory`, `Imports`, `Zones`, `Components`, `FileEntry`, `Zone`, `Finding`, `RouteTreeNode`, `RouteExportKind`, `ComponentUsageEdge`
- `src/schema/validate.ts` — Validation functions for loading data
- `src/schema/data-files.ts` — Constants: `DATA_FILES`, `ALL_DATA_FILES`, `SUPPLEMENTARY_FILES`

These are used by:
- **Server:** `start.ts`, `routes-data.ts`, `routes-sourcevision.ts` (3 files)
- **Viewer:** `main.ts`, `loader.ts`, `types.ts`, `schema-compat.ts`, `utils.ts`, `sidebar.ts`, `zone-map.ts`, and 8 view files (13 files total)

### Runtime Dependencies (No Imports — File/Process Based)

**Rex integration** (`routes-rex.ts`):
- Reads/writes `.rex/prd.json` directly via `fs`
- Reads `.rex/execution-log.jsonl` for analysis log
- Reads `.rex/pending-proposals.json` for proposal workflow
- Spawns `rex analyze` as a subprocess via `execFile()`
- Duplicates Rex types locally (Priority, ItemLevel, LEVEL_HIERARCHY, PRIORITY_ORDER) with `@see` references

**Hench integration** (`routes-hench.ts`):
- Reads `.hench/runs/*.json` directory via `fs`
- No subprocess calls, purely read-only

**Token usage** (`routes-token-usage.ts`):
- Reads `.hench/runs/*.json` for token analytics
- Cross-cutting: aggregates data from hench runs

### Dependency Summary

```
              ┌─────────────────────────────────────────────┐
              │  packages/sourcevision/src/cli/server/       │
              │  (HTTP server + all route handlers)          │
              ├─────────────────────────────────────────────┤
              │                                             │
  compile ──► │  src/schema/{v1, validate, data-files}.ts   │
              │                                             │
              │  .sourcevision/*.json  ◄── fs.readFile      │
   runtime ──►│  .rex/prd.json         ◄── fs.read/write   │
              │  .hench/runs/*.json    ◄── fs.readdir       │
              │  rex CLI               ◄── child_process    │
              │                                             │
              └─────────────────────────────────────────────┘
```

## Classification

### Sourcevision-Specific Code

Files that genuinely belong to the sourcevision package — they display or serve sourcevision analysis results:

- **Server:** `routes-sourcevision.ts` (1 file, 166 lines)
- **Views:** graph, zones, files, routes, architecture, problems, suggestions (7 files)
- **Components:** detail-panel, graph/physics, graph/renderer, data-display/zone-map (4 files)
- **Core:** schema-compat (1 file)
- **Styles:** graph, zone-map (2 files)

**Total SV-specific: ~15 files**

### N-DX Dashboard Code (Should Live at Orchestration Layer)

Files that serve or display rex, hench, or cross-cutting data:

- **Server:** start, types, routes-rex, routes-hench, routes-validation, routes-token-usage, routes-data, routes-static, websocket, index (10 files, ~2,958 lines)
- **Views:** prd, rex-dashboard, analysis, validation, token-usage, hench-runs (6 files)
- **Components:** rex-task-link, prd-tree/* (11 files)
- **Core:** main (app shell), loader (data fetching), types (shared types)
- **Styles:** prd-tree, rex-dashboard, task-link, hench-runs, analysis, token-usage, validation (7 files)
- **Build:** build.js, dev.js

**Total n-dx-level: ~40 files**

### Shared/Generic Code

Files that are framework infrastructure, used by both SV-specific and n-dx views:

- **Components:** sidebar, guide, theme-toggle, search-filter, logos, faq, constants, most of data-display/* (8+ files)
- **Styles:** base, tokens, layout, forms, cards, tables, utils, responsive, a11y, branding (10 files)
- **Assets:** index.html, logos

## Decision: Where Should This Code Live?

### Recommendation: `packages/web`

Create a new `packages/web` package to house the unified dashboard.

**Rationale:**

1. **The dashboard is not a sourcevision viewer.** 10 of 11 server files serve non-sourcevision data. 7 of 14 views are not sourcevision-specific. The server watches and serves `.rex/` and `.hench/` data with the same priority as `.sourcevision/` data.

2. **Sourcevision should remain independently installable.** When someone installs just sourcevision (e.g., `npx sourcevision analyze`), they shouldn't get rex PRD management UI, hench run viewers, and token analytics bundled in.

3. **The root `web.js` already treats the viewer as orchestration-level.** It lives at the monorepo root and delegates to `sourcevision serve` — acknowledging this is an n-dx concern, not a sourcevision concern.

4. **The existing MCP factory pattern supports this.** Rex and sourcevision both export `createXxxMcpServer()` factories. The web package can import these to mount MCP over HTTP alongside the REST API routes.

5. **Clean dependency direction.** `packages/web` depends on `packages/sourcevision` (schema types + MCP factory), `packages/rex` (MCP factory), and reads hench data from filesystem. No circular dependencies.

### Alternative Considered: Monorepo Root

Placing web code at the monorepo root (alongside `web.js`, `cli.js`, `config.js`) was considered but rejected:

- Root-level code is currently thin orchestration scripts (50-300 lines each)
- The viewer is a substantial codebase (~100 files, ~21K lines)
- A proper package provides its own `package.json`, tsconfig, test setup, and build pipeline
- Root-level doesn't support `pnpm build` / `pnpm test` per-package workflow

### Migration Approach (For Subsequent Tasks)

1. Create `packages/web` with its own `package.json`, tsconfig, build.js
2. Move all server code (`src/cli/server/*`) → `packages/web/src/server/`
3. Move all viewer code (`src/viewer/*`) → `packages/web/src/viewer/`
4. Move tests (`tests/unit/server/*`, `tests/unit/viewer/*`) → `packages/web/tests/`
5. Add dependencies: `@n-dx/sourcevision` (for schema types), `@n-dx/rex` (for MCP factory)
6. Copy the 3 schema files (`v1.ts`, `validate.ts`, `data-files.ts`) or re-export from sourcevision's public API
7. Update `web.js` to delegate to `packages/web` instead of `sourcevision serve`
8. Remove viewer/server code from sourcevision, keep sourcevision's `serve` command as a thin wrapper or remove it
9. Update build pipeline and CI
