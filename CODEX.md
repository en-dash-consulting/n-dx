<!--
  SYNC NOTICE — Sections that must be mirrored in CLAUDE.md:
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
  When updating any of these sections, update CLAUDE.md as well.
  CODEX.md additionally contains the Codex Troubleshooting section (unique to this file).
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

`web-server` is a parallel composition root — it wires gateways and routes but does not import from `web-viewer` at runtime (the viewer is built separately and served as static assets). `web-shared` is the foundation layer with zero upward dependencies (enforced by `boundary-check.test.ts`).

### Gateway modules

Packages that import from other packages at runtime concentrate **all** cross-package imports into a single gateway module. This makes the dependency surface explicit, auditable, and easy to update when upstream APIs change.

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
- **Messaging exemption** — `src/viewer/messaging/` files may import directly from `src/shared/` without going through `external.ts`. The shared/ directory is neutral (neither server nor viewer), and messaging utilities access it directly to avoid zone-level dependency inversion. Enforced by `boundary-check.test.ts`.
- **New cross-package imports** require a deliberate edit to the gateway, not a casual import in a leaf file.

See also: `PACKAGE_GUIDELINES.md` for the full pattern reference.

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

## CLI Color Convention

All CLI output across rex, hench, sourcevision, and the ndx orchestrator follows a
shared semantic color vocabulary defined in `packages/llm-client/src/help-format.ts`
(`STATUS_COLORS` map). Import `colorStatus` from `@n-dx/llm-client` (or the hench
`llm-gateway`) instead of writing your own status→color switch.

| Color  | Meaning                                                 |
|--------|---------------------------------------------------------|
| green  | completed · success — work is done                      |
| cyan   | in_progress · running · info — active or informational  |
| yellow | pending · blocked · warning — needs attention           |
| red    | failing · failed · error · timeout — problem state      |
| dim    | deferred · deleted · muted — background / done-and-gone |

**Tree-row vs badge coloring:** `status-shared.ts` `colorLine()` dims the *entire row*
for completed items to reduce visual noise in tree views. This is an intentional UX
choice distinct from status badge coloring — completed *badge labels* are green.

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

# Standalone binaries (also available after pnpm link --global)
rex <command> [args]
hench <command> [args]
sourcevision <command> [args]
sv <command> [args]               # alias for sourcevision
```

### Rex commands

`init`, `status`, `next`, `add`, `update`, `move`, `remove`, `reshape`, `prune`, `validate`, `fix`, `sync`, `usage`, `report`, `verify`, `recommend`, `analyze`, `reorganize`, `health`, `adapter`, `mcp`

### Sourcevision commands

`init`, `analyze`, `serve`, `validate`, `export-pdf`, `pr-markdown`, `git-credential-helper`, `reset`, `workspace`, `mcp`

### Hench commands

`init`, `run`, `config`, `template`, `status`, `show`

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
2. `ndx analyze .` — run SourceVision codebase analysis
3. `ndx recommend --accept .` — turn findings into PRD tasks
4. `ndx add "feature description" .` — add custom feature requests
5. `ndx work --auto .` — execute the next task autonomously
6. `ndx status .` — check progress

Use `ndx start .` for the dashboard + MCP server, `ndx self-heal 3 .` for iterative improvement loops.

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
| `ZONES.md` | Zone promotion checklist, zone ID naming convention, and zone-pin manifest |
