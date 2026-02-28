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

Packages that import from other packages at runtime concentrate **all** cross-package imports into a single gateway module. This makes the dependency surface explicit, auditable, and easy to update when upstream APIs change.

| Package | Gateway file | Imports from | Re-exports |
|---------|-------------|--------------|------------|
| hench | `src/prd/rex-gateway.ts` | rex | 8 functions (store, tree, task selection) |
| web | `src/server/domain-gateway.ts` | rex, sourcevision | 2 MCP server factories + rex domain types/constants |

Rules:
- **One gateway per package** — all runtime cross-package imports pass through it.
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

`init`, `status`, `next`, `add`, `update`, `validate`, `analyze`, `recommend`, `mcp`

### Sourcevision commands

`init`, `analyze`, `serve`, `validate`, `reset`, `mcp`

### Hench commands

`init`, `run`, `status`, `show`

## Codex Troubleshooting

### 1) Malformed Codex output (parse fallback)

Symptoms:
- Task run does not crash, but summary contains raw payload text.
- Warnings appear for missing/unknown block types.

Verify:
```sh
rg -n "normalizeCodexResponse|Codex block missing type|Unknown Codex block type" packages/hench/src/agent/lifecycle/cli-loop.ts
```
Expected:
- Matches exist for `normalizeCodexResponse`.
- Warning strings are present: `Codex block missing type; ignoring block.` and `Unknown Codex block type "..."`

```sh
pnpm --filter hench exec vitest run tests/unit/agent/codex-normalization.test.ts
```
Expected:
- Test names include `truncated JSON payload falls back to plain text` and `applies deterministic fallback behavior for malformed fixtures`.
- Suite passes without throwing on malformed payloads.

Operational signal during a run:
- `[Warn] Codex block missing type; ignoring block.`
- `[Warn] Unknown Codex block type "<type>" ignored.`

Remediation:
- If you wrap `codex exec`, ensure blocks include a `type` and text fields (`text`, `content`, `delta`, or `output_text`).
- Plain text output is supported; malformed JSON is treated as plain text fallback.

### 2) Missing usage fields / token mismatch in Codex mode

Symptoms:
- `hench show` reports `0 in / 0 out` despite a non-empty response.
- Token budget behavior looks lower than expected for that turn.

Verify:
```sh
rg -n "mapCodexUsageToTokenUsage|codex_usage_missing|input_tokens|prompt_tokens|completion_tokens|total_tokens" packages/hench/src/agent/lifecycle/token-usage.ts packages/hench/src/agent/lifecycle/cli-loop.ts
```
Expected:
- Mapping exists for:
  - input: `input_tokens | prompt_tokens | input`
  - output: `output_tokens | completion_tokens | output`
  - total: `total_tokens | total` (fallback to `input + output`)
- Diagnostic key `codex_usage_missing` is present.
- Warning text exists: `Codex response omitted usage; token accounting defaulted to zero.`

```sh
pnpm --filter hench exec vitest run tests/unit/agent/token-usage.test.ts
```
Expected:
- `mapCodexUsageToTokenUsage` cases pass, including:
  - nested `response.usage` mapping
  - zeroed usage with `codex_usage_missing` when usage is absent/empty

```sh
ndx hench show <run-id> --format=json .
```
Expected when usage fields are missing:
- `tokenUsage.input = 0`
- `tokenUsage.output = 0`
- `turnTokenUsage` still records the turn with zeros.

Remediation:
- Prefer emitting `usage.input_tokens` and `usage.output_tokens` from Codex-compatible wrappers.
- If upstream only provides `prompt_tokens`/`completion_tokens`, those are already mapped.
- If no usage fields are available, zero fallback is intentional; treat the warning as a data-quality signal.

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
