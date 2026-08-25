# n-dx

AI-powered development toolkit. Three packages that chain together: analyze a codebase, build a PRD, execute tasks autonomously.

## Packages

- **sourcevision** — Static analysis: file inventory, import graph, zone detection (Louvain community detection), React component catalog. Produces `.sourcevision/CONTEXT.md` and `llms.txt` for AI consumption.
- **rex** — PRD management: hierarchical epics/features/tasks/subtasks, `analyze` scans project + sourcevision output to generate proposals, `status` shows completion tree. Stores all PRD state in a slug-based folder tree at `.rex/prd_tree/`: one directory per item with an `index.md` file. No JSON files are written by PRD mutations.
- **hench** — Autonomous agent: picks next rex task, builds a brief, drives an LLM in a tool-use loop, records runs in `.hench/runs/`.

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
| Naming | All packages are `@n-dx/` scoped: `@n-dx/core`, `@n-dx/rex`, `@n-dx/hench`, `@n-dx/sourcevision`, `@n-dx/web`, `@n-dx/llm-client` | Short CLI invocation (`ndx`, `rex`, `hench`, `sv`) comes from `bin` entries, not from unscoped package names. Changesets must use the scoped name — an unscoped name fails `changeset status` with "not in the workspace" |
| Subpath exports | `"./dist/*": "./dist/*"` | Intentional escape hatch — not public API, no stability guarantee. See `PACKAGE_GUIDELINES.md` for acceptable/prohibited uses |

## Assistant Instruction Files

`ndx init` generates per-assistant instruction files from a shared source of truth (`packages/core/assistant-assets/project-guidance.md`). Each file has a defined role:

| File | Role | Generated from |
|------|------|----------------|
| `AGENTS.md` | **Canonical shared guidance surface.** Read by Codex and any future assistants. Contains project docs, workflow, skill inventory, and MCP tool reference derived from the asset manifest. | `project-guidance.md` (filtered) + manifest-derived sections + `codex-troubleshooting.md` |
| `CLAUDE.md` | **Claude-facing bridge.** Read by Claude Code on startup. Imports the same shared guidance plus Claude-specific deep sections (zone governance, gateway details, concurrency contract). | `project-guidance.md` + `claude-addendum.md` |
| `.codex/config.toml` | **Codex MCP configuration.** Auto-read by Codex — no manual registration required. | Manifest MCP server descriptors |

**Design invariant:** Both `AGENTS.md` and `CLAUDE.md` derive their base project documentation (Packages, Architecture, Commands, Key Files) from `project-guidance.md`. Vendor-specific additions are layered on top — never inlined into the shared template. This prevents instruction drift between assistant surfaces.

Re-run `ndx init` to regenerate all instruction files after changes to `packages/core/assistant-assets/`.

## n-dx Orchestration Commands

Run `ndx <command> --help` for full usage, or see `README.md` for the command reference and direct-tool-access aliases (`ndx rex`, `ndx hench`, `ndx sv`, or the standalone binaries).

**Gotcha:** `ndx work` autonomous runs (`--auto`/`--loop`/`--epic-by-epic`) default `--permission-mode` to `acceptEdits` so the spawned Claude session won't stall in plan mode — override with `--permission-mode` or `hench.permissionMode`. This default is enforced repo-wide via the hench system prompt for all CLI-provider runs (see the `/no-plan-mode` skill).

## MCP Servers

Rex and sourcevision expose MCP servers over HTTP (`ndx start`, port 3117 by default) and stdio (auto-registered by `ndx init`). HTTP uses [Streamable HTTP](https://modelcontextprotocol.io/) with session management (`Mcp-Session-Id` header, created automatically on first request). See `README.md` for registration commands.

**Migrating from stdio to HTTP (Claude):** start the server (`ndx start --background .`), remove the stdio registrations (`claude mcp remove rex && claude mcp remove sourcevision`), then add the HTTP ones (`claude mcp add --transport http rex http://localhost:3117/mcp/rex`, same for sourcevision).

### Rex MCP tools

Rex mutations write only to the folder tree (`.rex/prd_tree/`). No JSON files are produced by MCP write operations.

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
- `get_token_usage` — roll up hench run token totals per PRD item (self/descendants/total) with orphans surfaced separately
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

## Changeset Versioning

- **Always default changeset bumps to `patch`** across all affected packages unless explicitly instructed otherwise by a user.
- **Use the scoped package name** (`@n-dx/rex`, `@n-dx/hench`, …) in changeset frontmatter. An unscoped name is not in the workspace and fails `changeset status`, breaking the release pipeline.

## Key Files

| Path | Purpose |
|------|---------|
| `.rex/prd_tree/` | PRD storage root — slug-based folder tree; one directory per item (epic/feature/task) containing `index.md` |
| `.rex/prd.md` | (Legacy) flat Markdown PRD; migration source for `rex migrate-to-folder-tree`. Absent after migration. |
| `.rex/prd.json` | (Legacy) JSON PRD; migration source when neither `prd.md` nor the tree exists. |
| `.rex/execution-log.jsonl` | Append-only structured activity log (rotates to `.rex/execution-log.1.jsonl` at 1 MB) |
| `.rex/archive.json` | Pruned/reshaped item archive (written by `rex prune` and `rex reshape`; max 100 batches, auto-trimmed; safe to delete — only used for item recovery/audit) |
| `.n-dx.json` | Project-level config overrides (web.port, llm.vendor, llm.claude.model, llm.codex.model) |
| `tests/e2e/architecture-policy.test.js` | Spawn-only enforcement, intra-package layering, zone-cycle detection |
| `tests/e2e/domain-isolation.test.js` | Gateway enforcement, domain layer isolation, foundation tier boundary |
| `tests/e2e/mcp-transport.test.js` | MCP HTTP transport end-to-end validation (session management, tool calls) |
| `tests/e2e/integration-coverage-policy.test.js` | Minimum integration test file count, cross-package contract verification |
| `tests/e2e/cli-dev.test.js` | **Required test** — see [TESTING.md](TESTING.md#required-tests) |
| `tests/integration/scheduler-startup.test.js` | **Required test** — see [TESTING.md](TESTING.md#required-tests) |
| `OPEN_SOURCE_SCOPE.md` | Licensing boundaries, included/excluded components, and contribution expectations |

> **PRD file layout.** Subtasks are encoded as sections within the parent task's `index.md` (not separate directories). `.rex/.cache/prd.json` is an ephemeral derived file generated only while `ndx start` is running — do not read it from code outside the web server. See [`docs/architecture/prd-folder-tree-schema.md`](docs/architecture/prd-folder-tree-schema.md) for the full naming-convention, field schema, and serializer/parser contracts.
