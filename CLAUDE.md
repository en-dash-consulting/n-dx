<!--
  SYNC NOTICE — Sections that must be mirrored in CODEX.md:
    • Packages (list and descriptions)
    • Monorepo Structure (directory tree)
    • Architecture (four-tier hierarchy diagram)
    • Gateway modules (table and rules)
    • Package conventions (table)
    • Build and test commands
    • Command Aliases
    • Orchestration Commands
    • Direct Tool Access (rex, sourcevision, hench commands)
    • MCP Servers (HTTP/stdio setup, tool lists)
    • Development Workflow
    • Key Files table
  When updating any of these sections, update CODEX.md as well.
-->
# n-dx

AI-powered development toolkit. Three packages that chain together: analyze a codebase, build a PRD, execute tasks autonomously.

## Packages

- **sourcevision** — Static analysis: file inventory, import graph, zone detection (Louvain community detection), React component catalog. Produces `.sourcevision/CONTEXT.md` and `llms.txt` for AI consumption.
- **rex** — PRD management: hierarchical epics/features/tasks/subtasks, `analyze` scans project + sourcevision output to generate proposals, `status` shows completion tree. Stores state in `.rex/prd.json`.
- **hench** — Autonomous agent: picks next rex task, builds a brief, calls Claude API or CLI in a tool-use loop, records runs in `.hench/runs/`.

## Monorepo Structure

```
packages/
  core/            # CLI orchestrator (published as @n-dx/core)
  sourcevision/    # analysis engine
  rex/             # PRD + task tracker
  hench/           # autonomous agent
  llm-client/      # vendor-neutral LLM foundation (claude adapter + future vendors)
  web/             # dashboard + MCP HTTP server
```

### Architecture

Four-tier dependency hierarchy (each layer imports only from the layer below):

```
  Orchestration   packages/core/               (spawns CLIs, no library imports)
                  config.js                     (spawn-exempt — see note below)
       ↓
  Execution       hench                         (agent loops, tool dispatch)
       ↓
  Domain          rex · sourcevision            (independent, never import each other)
       ↓
  Foundation      @n-dx/llm-client              (shared types, API client)
```

Zero circular dependencies. The web package sits alongside orchestration — it imports all domain packages to serve the unified dashboard.

#### Web package internal zone layering

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

##### Monorepo-wide zone fragility governance

Any production zone with **cohesion < 0.5 AND coupling > 0.5** is a dual-fragility zone requiring active governance. The following zones currently meet both thresholds:

| Zone | Package | Cohesion | Coupling | Notes |
|------|---------|----------|----------|-------|
| `web-shared` | web | 0.36 | 0.64 | Foundation layer; 3 files (metrics unreliable at this size); two-consumer rule enforced by `boundary-check.test.ts` |
| `rex-cli` | rex | 0.25 | 0.75 | 27+ command files in flat directory; high coupling to core |
| `prd-fix-command` | rex | 0.25 | 0.75 | Satellite CLI zone; 2 files with tight core coupling |
| `crash` | web | 0.50 | unidirectional (web-viewer → crash) | At threshold boundary — crash imports web-shared directly (documented bypass), not web-viewer |
| `web-dashboard-platform` | web | 0.53 | — | Watch designation; 33 files (metrics reliable); 0.03 above dual-fragility threshold — baseline documented for regression tracking |

**Universal governance rules** (apply to all dual-fragility zones):
- **Two-consumer rule:** A new module must have at least two distinct consumer zones before being added. Single-consumer utilities belong closer to their dominant use site.
- **Addition review required:** Treat these as risk zones requiring active review on additions. Changes have a wide blast radius.
- **Cohesion monitoring:** If a zone's cohesion drops below its current value after a change, the change needs explicit justification.

##### web-shared addition policy

`web-shared` has low cohesion (0.36) and high coupling (0.64). The zone contains only 3 files (below the 5-file threshold for reliable metrics), so the measured values reflect the inherent low internal relationship between its two modules (data-file constants vs view identifiers) rather than structural decay. In addition to the universal governance rules above:

- **Framework-agnostic only:** `web-shared` must not contain Preact/React imports or server-only (`node:*`) imports. If a utility needs framework APIs, it belongs in the consuming zone.
- **Barrel import enforcement:** Consumers must import through `shared/index.ts` rather than directly from leaf files (`data-files.ts`, `view-id.ts`). Enforced by `boundary-check.test.ts`.
- **Two-consumer rule (automated):** Every module in `shared/` must have at least two distinct consumer zones. Enforced by the "shared/ modules have at least two consumer zones" assertion in `boundary-check.test.ts`.

##### rex-satellite zone policy

Both `chunked-review` and `prd-fix-command` are satellite zones of `rex-cli` with cohesion 0.25 and coupling 0.75. In addition to the universal governance rules:

- **CLI-only content:** These zones must contain only CLI command handlers and their direct support modules. Domain logic belongs in `rex-prd-engine` (e.g., `src/core/`).
- **Subdirectory convention:** Satellite zone files should be grouped into subdirectories under `packages/rex/src/cli/commands/` to make zone boundaries visible in the file tree.

##### crash zone proactive governance

`crash` (cohesion 0.5, unidirectional coupling: web-viewer → crash) sits at the dual-fragility threshold boundary. Crash imports web-shared directly (documented bypass) rather than web-viewer. Apply the two-consumer rule proactively to new crash zone additions before cohesion degrades further.

##### hench-agent internal governance

`hench-agent` (160+ files, 31 directories) is the second-largest zone in the monorepo. Internal sub-zone boundaries:

- **`agent/`** — Agent loop, tool dispatch, conversation management
- **`prd/`** — PRD integration via `rex-gateway.ts` and `llm-gateway.ts`
- **`brief/`** — Task brief construction and context gathering
- **`tools/`** — Tool implementations (file ops, shell, search)
- **`process/`** — Process lifecycle, concurrency management

Rules:
- Each sub-zone directory should maintain a barrel `index.ts` re-exporting its public API.
- Cross-sub-zone imports should flow through barrels, not reach into internal modules.
- Boundary assertions should be added to hench's test suite before the zone reaches web-viewer's scale.

`web-viewer` is the hub: it imports from `viewer-message-pipeline` (via `external.ts`) and `web-shared`, while also receiving imports from sub-zones like `crash/` and `hench-agent-monitor`. The actual import graph has 11+ distinct cross-zone edges radiating from `web-viewer`, making it a hub rather than a linear stack. `web-server` is a parallel composition root — it wires gateways and routes but does not import from `web-viewer` at runtime (the viewer is built separately and served as static assets). `web-shared` is the foundation layer with zero upward dependencies (enforced by `boundary-check.test.ts`).

> **Spawn-exempt exception:** `config.js` directly reads/writes package config files (`.rex/config.json`, `.hench/config.json`, `.sourcevision/manifest.json`, `.n-dx.json`) rather than delegating to spawned CLIs. This is intentional — config operations require cross-package reads, atomic merges, and validation logic that cannot be expressed as a single CLI spawn. It is the only orchestration-tier script that breaks the spawn-only rule.

### Gateway modules

Packages that import from other packages at runtime concentrate **all** cross-package imports into a single gateway module per upstream package. This makes the dependency surface explicit, auditable, and easy to update when upstream APIs change.

| Package | Gateway file | Imports from | Re-exports |
|---------|-------------|--------------|------------|
| hench | `src/prd/rex-gateway.ts` | rex | 19 functions + 6 types (schema, store, tree, task selection, timestamps, auto-completion, requirements, level helpers, finding acknowledgment) |
| hench | `src/prd/llm-gateway.ts` | @n-dx/llm-client | 30 functions + 10 types (config, constants, JSON, output, help, errors, process execution, token parsing, model resolution) |
| web | `src/server/rex-gateway.ts` | rex | Rex MCP server factory, domain types & constants, tree utilities |
| web | `src/server/domain-gateway.ts` | sourcevision | Sourcevision MCP server factory |
| web | `src/viewer/external.ts` | `src/viewer/messaging/`, `src/shared/`, `src/schema/` | Schema types (V1), data-file constants, RequestDedup — viewer↔server boundary gateway |
| web | `src/viewer/api.ts` | `src/viewer/types.ts`, `src/viewer/route-state.ts` | Viewer types (LoadedData, NavigateTo, DetailItem), route-state functions — inbound API contract for sibling zones (crash, route, performance) |

Rules:
- **One gateway per source package** — all runtime imports from a given upstream package pass through a single gateway. A consumer may have multiple gateways (e.g. web has separate gateways for rex and sourcevision).
- **Intra-package gateways** — within the web package, `src/viewer/external.ts` concentrates all viewer-side imports from `src/viewer/messaging/`, `src/shared/`, and `src/schema/`. `RequestDedup` is canonically located in `src/viewer/messaging/request-dedup.ts` and re-exported through `external.ts` for viewer consumers.
- **Re-export only** — gateways re-export; they contain no logic. Enforced by `domain-isolation.test.js`.
- **Type imports through gateway** — `import type` must also flow through gateways to prevent type-import promotion erosion (a type import can be silently promoted to a runtime import during refactoring). Exception: web viewer files are exempt because the server/viewer boundary prevents them from reaching the server-side gateway.
- **Messaging exemption** — `src/viewer/messaging/` files may import directly from `src/shared/` without going through `external.ts`. The shared/ directory is neutral (neither server nor viewer), and messaging utilities access it directly to avoid zone-level dependency inversion. Enforced by `boundary-check.test.ts` (lines 74–80). New files added to `viewer/messaging/` inherit this exemption — review them to ensure they are genuine messaging infrastructure, not general viewer code.
- **New cross-package imports** require a deliberate edit to the gateway, not a casual import in a leaf file.

See also: `PACKAGE_GUIDELINES.md` for the full pattern reference.

### Injection seam registry

Some cross-zone dependencies use callback injection rather than gateway imports. These seams are invisible to static analysis tools (boundary-check.test.ts, domain-isolation.test.js) and must be listed explicitly to prevent future contributors from replacing injection with direct imports.

| Injection site | Target module | Injected callbacks | Interface type |
|----------------|---------------|--------------------|----------------|
| `web/src/server/start.ts` | `web/src/server/register-scheduler.ts` | `broadcast`, `collectAllIds`, `loadPRD`, `getAggregator` | `RegisterSchedulerOptions` |

Rules:
- **Prefer injection over import** when the target module would otherwise need to import from a higher-tier zone (e.g., scheduler importing from dashboard wiring).
- **Document the interface type** — every injection seam must have a named TypeScript interface (not inline parameter types) so that refactoring either side triggers a type error.
- **New seams** require an entry in this table and a named interface type in the target module.

### Tier boundary crossing: spawn vs gateway

When a new feature requires crossing a tier boundary, use this decision rule:

| Signal | Use spawn (child process) | Use gateway module (direct import) |
|--------|--------------------------|-----------------------------------|
| Caller tier | Orchestration (cli.js, ci.js, web.js) | Execution or Domain |
| Data flow | Fire-and-forget or exit-code only | Structured return values needed in-process |
| Frequency | Per-command (once per CLI invocation) | Per-request (hot path, many calls per second) |
| Error handling | Exit code + stderr is sufficient | Caller needs typed errors, retries, or partial results |
| State sharing | None (each spawn is stateless) | Shared in-memory state (e.g. PRDStore instance) |

**Rules of thumb:**
- Orchestration-tier scripts **always spawn** — they must not `import` from packages (exception: `config.js` for cross-package config reads).
- If the consumer is a library (hench, web), use a **gateway module** to keep the import surface explicit and auditable.
- If in doubt, prefer spawn — it provides stronger isolation and can always be replaced with a gateway later if performance requires it.

### Concurrency contract

The four orchestration entry points (`cli.js`, `web.js`, `ci.js`, `config.js`) share mutable state files on disk. Concurrent execution rules:

| Command pair | Safe? | Notes |
|-------------|-------|-------|
| `ndx start` + `ndx status` | ✅ | Status is read-only |
| `ndx start` + `ndx work` | ✅ | Hench writes to `.hench/runs/`, server reads `.rex/prd.json` — no conflict |
| `ndx start` + `ndx plan` | ⚠️ | Plan writes `.rex/prd.json` which the server reads — server may see partial writes. Restart server after plan. |
| `ndx ci` + `ndx work` | ❌ | Both may write `.sourcevision/` and `.rex/prd.json` concurrently |
| `ndx plan` + `ndx work` | ❌ | Both write `.rex/prd.json` — data corruption risk |
| `ndx refresh` + any write command | ❌ | Refresh writes `.sourcevision/` and rebuilds web assets |
| `ndx config` + `ndx config` | ❌ | Concurrent config writes may lose updates (no file locking) |

**General rule:** Commands that write to `.rex/prd.json`, `.sourcevision/`, or `.hench/config.json` must not run concurrently. Read-only commands (`status`, `usage`) are always safe.

**MCP write operations** (`add_item`, `edit_item`, `update_task_status`, `merge_items`, `move_item`) also write to `.rex/prd.json`. Never invoke MCP write tools while a CLI command that writes to the PRD is running in the background (e.g., `reorganize`, `prune`, `reshape`, `analyze`, `plan`). The last writer wins silently — no error, just data loss. Always wait for the background command to complete before making MCP writes.

#### HTTP-request concurrency (web server)

When `ndx start` is running, the web server holds in-process caches (aggregation cache, PRD tree snapshot) that are populated from disk on demand. External CLI commands that write to the same files can cause stale or partial reads:

| Scenario | Risk | Mitigation |
|----------|------|------------|
| Dashboard reads PRD while `ndx plan` writes `.rex/prd.json` | Partial JSON read → parse error or stale tree | Restart server after plan (`ndx start stop && ndx start`) |
| MCP request during `ndx work` PRD update | Momentarily stale status — hench writes are small atomic updates | Acceptable — dashboard polls and self-corrects within seconds |
| Concurrent dashboard API requests | Safe — Express serializes requests per-connection; no shared mutable state between request handlers | No action needed |

**General rule for HTTP:** The web server treats disk files as read-only and never holds write locks. Any command that rewrites `.rex/prd.json` or `.sourcevision/` in bulk (plan, ci, refresh) should be followed by a server restart to flush stale caches.

### Package conventions

| Convention | Pattern | Notes |
|-----------|---------|-------|
| Public API | `src/public.ts` → `exports["."]` in `package.json` | All 5 packages follow this |
| Test structure | `tests/{unit,integration,e2e}/**/*.test.ts` | Standardized across all packages |
| Naming | Mixed: `rex`, `sourcevision`, `hench` (unscoped) / `@n-dx/web`, `@n-dx/llm-client` (scoped) | Intentional: CLI tools use short unscoped names for `npx`/`pnpm exec`; internal-only packages use the `@n-dx/` scope |
| Subpath exports | `"./dist/*": "./dist/*"` | Intentional escape hatch — not public API, no stability guarantee. See `PACKAGE_GUIDELINES.md` for acceptable/prohibited uses |

Build and test:

```sh
pnpm build          # build all packages
pnpm test           # test all packages
pnpm typecheck      # typecheck all packages
```

## Command Aliases

Both `n-dx` and `ndx` work identically (`ndx` is shorter to type).
`sv` is an alias for `sourcevision`.

## n-dx Orchestration Commands

```sh
ndx init [dir]            # sourcevision init → rex init → hench init
ndx analyze [dir]         # sourcevision analyze (--deep, --full, --lite)
ndx recommend [dir]       # rex recommend (--accept, --actionable-only, --acknowledge)
ndx add "description"     # smart-add PRD items from freeform descriptions
ndx add --file=spec.md    # import ideas from a text file
ndx plan [dir]            # sourcevision analyze → rex analyze (show proposals)
ndx plan --accept [dir]   # ...then accept proposals into PRD
ndx work [dir]            # hench run (pass --task=ID, --auto, --iterations=N, etc.)
ndx self-heal [N] [dir]   # iterative improvement loop (analyze → recommend → execute)
ndx start [dir]           # start server: dashboard + MCP endpoints (--port=N, --background, stop, status)
ndx status [dir]          # rex status (pass --format=json)
ndx usage [dir]           # token usage analytics (--format=json, --group=day|week|month)
ndx sync [dir]            # sync local PRD with remote adapter (--push, --pull)
ndx refresh [dir]         # refresh dashboard artifacts (--ui-only, --data-only, --no-build)
ndx dev [dir]             # start web dev server with live reload
ndx ci [dir]              # run analysis pipeline and validate PRD health (--format=json)
ndx config [key] [value]  # view/edit settings (--json, --help)
ndx export [dir]          # export static deployable dashboard (--out-dir, --deploy=github)
```

## Direct Tool Access

```sh
# Via orchestrator
ndx rex <command> [args]
ndx hench <command> [args]
ndx sourcevision <command> [args]
ndx sv <command> [args]           # alias for sourcevision

# Standalone binaries (also available after npm link)
rex <command> [args]
hench <command> [args]
sourcevision <command> [args]
sv <command> [args]               # alias for sourcevision
```

### Rex commands

`init`, `status`, `next`, `add`, `remove`, `update`, `validate`, `analyze`, `recommend`, `mcp`

### Sourcevision commands

`init`, `analyze`, `serve`, `validate`, `reset`, `mcp`

### Hench commands

`init`, `run`, `status`, `show`

## MCP Servers

Rex and sourcevision expose MCP servers for Claude Code tool use. Two transport options are available: **HTTP** (recommended) and **stdio** (legacy).

### HTTP transport (recommended)

Start the unified server, then point Claude Code at the HTTP endpoints:

```sh
# 1. Start the server (dashboard + MCP on one port)
ndx start .

# 2. Add HTTP MCP servers to Claude Code
claude mcp add --transport http rex http://localhost:3117/mcp/rex
claude mcp add --transport http sourcevision http://localhost:3117/mcp/sourcevision
```

The server runs on port 3117 by default. If you use a custom port (`--port=N` or `web.port` in `.n-dx.json`), update the URLs accordingly.

HTTP transport uses [Streamable HTTP](https://modelcontextprotocol.io/) with session management. Sessions are created automatically on the first request and identified by the `Mcp-Session-Id` header.

### stdio transport (legacy)

Stdio spawns a separate process per MCP server. No `ndx start` required, but each server runs independently:

```sh
claude mcp add rex -- node packages/rex/dist/cli/index.js mcp .
claude mcp add sourcevision -- node packages/sourcevision/dist/cli/index.js mcp .
```

### Migrating from stdio to HTTP

1. Start the server: `ndx start --background .`
2. Remove old stdio servers: `claude mcp remove rex && claude mcp remove sourcevision`
3. Add HTTP servers: `claude mcp add --transport http rex http://localhost:3117/mcp/rex && claude mcp add --transport http sourcevision http://localhost:3117/mcp/sourcevision`

Benefits of HTTP over stdio: single process, shared port with the web dashboard, session management, no per-tool process overhead.

### Rex MCP tools

- `rex_status` — PRD tree with completion stats
- `rex_next` — next actionable task
- `rex_add` — add epic/feature/task/subtask
- `rex_update` — update item status/priority/title
- `rex_validate` — check PRD integrity
- `rex_analyze` — scan project and propose PRD items
- `rex_recommend` — get sourcevision-based recommendations

### Sourcevision MCP tools

- `sv_inventory` — file listing with metadata
- `sv_imports` — dependency graph for a file
- `sv_zones` — architectural zone map
- `sv_components` — React component catalog
- `sv_context` — full CONTEXT.md contents

## Development Workflow

1. `ndx init .` — set up all tool directories
2. `ndx start .` — start server (dashboard + MCP endpoints)
3. `ndx plan .` — analyze codebase, review proposals
4. `ndx plan --accept .` — accept proposals into PRD
5. `ndx work .` — execute next task autonomously
6. `ndx status .` — check progress

Use `ndx start --background .` for daemon mode, `ndx start status .` to check, `ndx start stop .` to stop.

## Key Files

| Path | Purpose |
|------|---------|
| `.sourcevision/CONTEXT.md` | AI-readable codebase summary |
| `.sourcevision/manifest.json` | Analysis metadata and version |
| `.rex/prd.json` | PRD tree (epics → features → tasks → subtasks) |
| `.rex/workflow.md` | Human-readable workflow state |
| `.rex/config.json` | Rex project configuration |
| `.hench/config.json` | Hench agent configuration (model, max turns) |
| `.hench/runs/` | Run history and transcripts |
| `.rex/archive.json` | Pruned/reshaped item archive (written by `rex prune` and `rex reshape`; max 100 batches, auto-trimmed; safe to delete — only used for item recovery/audit) |
| `.n-dx.json` | Project-level config overrides (web.port, etc.) |
| `.n-dx-web.pid` | Background web server PID file (auto-managed) |
| `tests/e2e/architecture-policy.test.js` | Spawn-only enforcement, intra-package layering, zone-cycle detection |
| `tests/e2e/domain-isolation.test.js` | Gateway enforcement, domain layer isolation, foundation tier boundary |
| `tests/e2e/mcp-transport.test.js` | MCP HTTP transport end-to-end validation (session management, tool calls) |
| `tests/e2e/integration-coverage-policy.test.js` | Minimum integration test file count, cross-package contract verification |
| `tests/e2e/cli-dev.test.js` | **Required test** — see [TESTING.md](TESTING.md#required-tests) |
| `tests/integration/scheduler-startup.test.js` | **Required test** — see [TESTING.md](TESTING.md#required-tests) |
