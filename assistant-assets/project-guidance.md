# n-dx

AI-powered development toolkit. Three packages that chain together: analyze a codebase, build a PRD, execute tasks autonomously.

## Packages

- **sourcevision** — Static analysis: file inventory, import graph, zone detection (Louvain community detection), React component catalog. Produces `.sourcevision/CONTEXT.md` and `llms.txt` for AI consumption.
- **rex** — PRD management: hierarchical epics/features/tasks/subtasks, `analyze` scans project + sourcevision output to generate proposals, `status` shows completion tree. Stores state in `.rex/prd.json`.
- **hench** — Autonomous agent: picks next rex task, builds a brief, drives an LLM in a tool-use loop, records runs in `.hench/runs/`.

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

`web-viewer` is the hub: it imports from `viewer-message-pipeline` (via `external.ts`) and `web-shared`, while also receiving imports from sub-zones like `crash/` and `hench-agent-monitor`. The actual import graph has 11+ distinct cross-zone edges radiating from `web-viewer`, making it a hub rather than a linear stack. `web-server` is a parallel composition root — it wires gateways and routes but does not import from `web-viewer` at runtime (the viewer is built separately and served as static assets). `web-shared` is the foundation layer with zero upward dependencies (enforced by `boundary-check.test.ts`).

<!-- ADDENDUM -->

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

## Assistant Instruction Files

`ndx init` generates per-assistant instruction files from a shared source of truth (`assistant-assets/project-guidance.md`). Each file has a defined role:

| File | Role | Generated from |
|------|------|----------------|
| `AGENTS.md` | **Canonical shared guidance surface.** Read by Codex and any future assistants. Contains project docs, workflow, skill inventory, and MCP tool reference derived from the asset manifest. | `project-guidance.md` (filtered) + manifest-derived sections + `codex-troubleshooting.md` |
| `CLAUDE.md` | **Claude-facing bridge.** Read by Claude Code on startup. Imports the same shared guidance plus Claude-specific deep sections (zone governance, gateway details, concurrency contract). | `project-guidance.md` + `claude-addendum.md` |
| `.codex/config.toml` | **Codex MCP configuration.** Auto-read by Codex — no manual registration required. | Manifest MCP server descriptors |

**Design invariant:** Both `AGENTS.md` and `CLAUDE.md` derive their base project documentation (Packages, Architecture, Commands, Key Files) from `project-guidance.md`. Vendor-specific additions are layered on top — never inlined into the shared template. This prevents instruction drift between assistant surfaces.

Re-run `ndx init` to regenerate all instruction files after changes to `assistant-assets/`.

## Command Aliases

Both `n-dx` and `ndx` work identically (`ndx` is shorter to type).
`sv` is an alias for `sourcevision`.

## n-dx Orchestration Commands

```sh
ndx init [dir]            # sourcevision init → rex init → hench init + LLM model selection
                          #   --provider=claude|codex  --model=<id>
                          #   --claude-model=<id>  --codex-model=<id>
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

Rex and sourcevision expose MCP servers for Claude Code and Codex tool use. Two transport options are available: **HTTP** (recommended for Claude) and **stdio** (default for both assistants after `ndx init`).

### HTTP transport (recommended)

Start the unified server, then point your assistant at the HTTP endpoints:

```sh
# 1. Start the server (dashboard + MCP on one port)
ndx start .

# 2. Register HTTP MCP servers (Claude example)
claude mcp add --transport http rex http://localhost:3117/mcp/rex
claude mcp add --transport http sourcevision http://localhost:3117/mcp/sourcevision
```

Any MCP-compatible assistant can connect to these endpoints. The server runs on port 3117 by default. If you use a custom port (`--port=N` or `web.port` in `.n-dx.json`), update the URLs accordingly.

HTTP transport uses [Streamable HTTP](https://modelcontextprotocol.io/) with session management. Sessions are created automatically on the first request and identified by the `Mcp-Session-Id` header.

### stdio transport

Stdio spawns a separate process per MCP server. No `ndx start` required. `ndx init` auto-registers stdio servers for both Claude Code and Codex.

**Claude Code** (manual registration):

```sh
claude mcp add rex -- node packages/rex/dist/cli/index.js mcp .
claude mcp add sourcevision -- node packages/sourcevision/dist/cli/index.js mcp .
```

**Codex** reads `.codex/config.toml` automatically — no manual registration required.

### Migrating from stdio to HTTP (Claude)

1. Start the server: `ndx start --background .`
2. Remove old stdio servers: `claude mcp remove rex && claude mcp remove sourcevision`
3. Add HTTP servers: `claude mcp add --transport http rex http://localhost:3117/mcp/rex && claude mcp add --transport http sourcevision http://localhost:3117/mcp/sourcevision`

Benefits of HTTP over stdio: single process, shared port with the web dashboard, session management, no per-tool process overhead.

### Rex MCP tools

- `get_prd_status` — PRD title, overall stats, and per-epic stats
- `get_next_task` — next actionable task based on priority and dependencies
- `update_task_status` — update item status
- `add_item` — add epic/feature/task/subtask
- `edit_item` — edit item content (title, description, priority, tags)
- `get_item` — full item details with parent chain
- `move_item` — reparent an item in the PRD tree
- `merge_items` — consolidate duplicate sibling items
- `get_recommendations` — sourcevision-based recommendations
- `verify_criteria` — map acceptance criteria to test files
- `reorganize` — detect and fix structural issues
- `health` — PRD structure health score
- `facets` — list configured facets with distribution
- `append_log` — write structured log entry
- `sync_with_remote` — sync with remote adapter (e.g. Notion)
- `get_capabilities` — server capabilities and configuration

### Sourcevision MCP tools

- `get_overview` — project summary statistics
- `get_next_steps` — prioritized improvement recommendations
- `get_zone` — architectural zone details
- `get_findings` — analysis findings (anti-patterns, suggestions, observations)
- `get_file_info` — file inventory entry, zone, and imports
- `search_files` — search inventory by path, role, or language
- `get_imports` — import graph edges
- `get_classifications` — file archetype classifications
- `set_file_archetype` — override archetype classification for a file
- `get_route_tree` — route structure (pages, API routes, layouts)

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
| `.n-dx.json` | Project-level config overrides (web.port, llm.vendor, llm.claude.model, llm.codex.model) |
| `.n-dx-web.pid` | Background web server PID file (auto-managed) |
| `tests/e2e/architecture-policy.test.js` | Spawn-only enforcement, intra-package layering, zone-cycle detection |
| `tests/e2e/domain-isolation.test.js` | Gateway enforcement, domain layer isolation, foundation tier boundary |
| `tests/e2e/mcp-transport.test.js` | MCP HTTP transport end-to-end validation (session management, tool calls) |
| `tests/e2e/integration-coverage-policy.test.js` | Minimum integration test file count, cross-package contract verification |
| `tests/e2e/cli-dev.test.js` | **Required test** — see [TESTING.md](TESTING.md#required-tests) |
| `tests/integration/scheduler-startup.test.js` | **Required test** — see [TESTING.md](TESTING.md#required-tests) |
