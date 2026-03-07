# n-dx

AI-powered development toolkit. Three packages that chain together: analyze a codebase, build a PRD, execute tasks autonomously.

## Packages

- **sourcevision** — Static analysis: file inventory, import graph, zone detection (Louvain community detection), React component catalog. Produces `.sourcevision/CONTEXT.md` and `llms.txt` for AI consumption.
- **rex** — PRD management: hierarchical epics/features/tasks/subtasks, `analyze` scans project + sourcevision output to generate proposals, `status` shows completion tree. Stores state in `.rex/prd.json`.
- **hench** — Autonomous agent: picks next rex task, builds a brief, calls Claude API or CLI in a tool-use loop, records runs in `.hench/runs/`.

## Monorepo Structure

```
packages/
  sourcevision/    # analysis engine
  rex/             # PRD + task tracker
  hench/           # autonomous agent
  claude-client/   # compatibility bridge to llm-client
  llm-client/      # vendor-neutral LLM foundation (claude adapter + future vendors)
  web/             # dashboard + MCP HTTP server
ci.js              # CI pipeline (analysis + PRD health validation)
cli.js             # n-dx entry point (orchestration + delegation)
config.js          # unified config command (view/edit all package settings)
web.js             # server orchestration: dashboard + MCP (start/stop/status)
```

### Architecture

Four-tier dependency hierarchy (each layer imports only from the layer below):

```
  Orchestration   cli.js, web.js, ci.js        (spawns CLIs, no library imports)
       ↓
  Execution       hench                         (agent loops, tool dispatch)
       ↓
  Domain          rex · sourcevision            (independent, never import each other)
       ↓
  Foundation      @n-dx/llm-client              (shared types, API client)
```

Zero circular dependencies. The web package sits alongside orchestration — it imports all domain packages to serve the unified dashboard.

### Gateway modules

Packages that import from other packages at runtime concentrate **all** cross-package imports into a single gateway module per upstream package. This makes the dependency surface explicit, auditable, and easy to update when upstream APIs change.

| Package | Gateway file | Imports from | Re-exports |
|---------|-------------|--------------|------------|
| hench | `src/prd/rex-gateway.ts` | rex | 8 functions (store, tree, task selection) |
| web | `src/server/rex-gateway.ts` | rex | Rex MCP server factory, domain types & constants, tree utilities |
| web | `src/server/domain-gateway.ts` | sourcevision | Sourcevision MCP server factory |

Rules:
- **One gateway per source package** — all runtime imports from a given upstream package pass through a single gateway. A consumer may have multiple gateways (e.g. web has separate gateways for rex and sourcevision).
- **Re-export only** — gateways re-export; they contain no logic.
- **Type imports excluded** — `import type` is erased at compile time and stays at the call-site.
- **New cross-package imports** require a deliberate edit to the gateway, not a casual import in a leaf file.

See also: `PACKAGE_GUIDELINES.md` for the full pattern reference.

### Package conventions

| Convention | Pattern | Notes |
|-----------|---------|-------|
| Public API | `src/public.ts` → `exports["."]` in `package.json` | All 5 packages follow this |
| Test structure | `tests/{unit,integration,e2e}/**/*.test.ts` | Standardized across all packages |
| Naming | Mixed: `rex`, `sourcevision`, `hench` (unscoped) / `@n-dx/web`, `@n-dx/llm-client` (scoped) | Intentional: CLI tools use short unscoped names for `npx`/`pnpm exec`; internal-only packages use the `@n-dx/` scope |
| Subpath exports | `"./dist/*": "./dist/*"` | Allows direct imports from `dist/` for advanced consumers |

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
ndx config llm.vendor ... # set active LLM vendor (claude|codex)
ndx plan [dir]            # sourcevision analyze → rex analyze (show proposals)
ndx plan --accept [dir]   # ...then accept proposals into PRD
ndx work [dir]            # hench run (pass --task=ID, --dry-run, etc.)
ndx status [dir]          # rex status (pass --format=json)
ndx usage [dir]           # token usage analytics (--format=json, --group=day|week|month)
ndx sync [dir]            # sync local PRD with remote adapter (--push, --pull)
ndx start [dir]           # start server: dashboard + MCP endpoints (--port=N, --background, stop, status)
ndx web [dir]             # alias for start (legacy name)
ndx dev [dir]             # start web dev server with live reload
ndx ci [dir]              # run analysis pipeline and validate PRD health (--format=json)
ndx config [key] [value]  # view/edit settings (--json, --help)
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
| `.n-dx.json` | Project-level config overrides (web.port, etc.) |
| `.n-dx-web.pid` | Background web server PID file (auto-managed) |
