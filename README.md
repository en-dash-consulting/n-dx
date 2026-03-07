# n-dx

AI-powered development toolkit. Three packages that chain together: analyze a codebase, build a PRD, execute tasks autonomously.

| | | |
|:---:|:---:|:---:|
| [![SourceVision](packages/sourcevision/SourceVision.png)](packages/sourcevision) | [![Rex](packages/rex/Rex.png)](packages/rex) | [![Hench](packages/hench/Hench.png)](packages/hench) |
| **[SourceVision](packages/sourcevision)** | **[Rex](packages/rex)** | **[Hench](packages/hench)** |
| Static analysis & zone detection | PRD management & task tracking | Autonomous agent execution |

## Quick Start

```sh
pnpm install
pnpm build

# Register CLI globally
npm link
# or
pnpm link --global

# Initialize all tools in a project
ndx init .

# Select LLM vendor for this project
ndx config llm.vendor claude .

# Analyze codebase and generate PRD proposals
ndx plan .

# Accept proposals into the PRD
ndx plan --accept .

# Execute the next task autonomously
ndx work .

# Check progress
ndx status .
```

## Beginner Workflow

Use this as the default day-to-day loop in a project root.

```sh
# 0) One-time setup
pnpm install
pnpm build
npm link

# 1) Initialize project folders (.sourcevision/.rex/.hench)
ndx init .
```

**2) Configure your LLM vendor (choose one):**

**Claude (recommended)**

```sh
ndx config llm.vendor claude .

# Option A: API mode (recommended — best token accounting and reliability)
ndx config llm.claude.api_key sk-ant-... .   # or: export ANTHROPIC_API_KEY=sk-ant-...
# Optionally pin a model (default: claude-sonnet-4-6)
ndx config llm.claude.model claude-opus-4-20250514 .

# Option B: CLI mode (no API key required)
ndx config llm.claude.cli_path claude .       # omit if `claude` is already on PATH
claude login
```

**Codex**

```sh
ndx config llm.vendor codex .
ndx config llm.codex.cli_path codex .
ndx config rex.model gpt-5.3-codex .
codex login
```

### A. Analyze codebase health (SourceVision)

```sh
ndx sourcevision analyze .
```

What you get:
- Updated `.sourcevision/` outputs (`zones.json`, `CONTEXT.md`, findings, etc.)
- Architecture and coupling warnings that Rex can turn into PRD tasks

### B. Turn findings into PRD work (Rex)

```sh
# See recommendations from SourceVision findings
ndx rex recommend .

# Add all shown recommendations to PRD
ndx rex recommend --accept .
```

Notes:
- `recommend --accept` accepts all current recommendations.
- If you want to skip specific ones, use acknowledgements instead:

```sh
# Acknowledge finding numbers from the current list
ndx rex recommend --acknowledge=1,2 .
```

### C. Add custom feature requests (Rex Smart Add)

```sh
# Natural language feature request -> structured epic/feature/task proposal
ndx rex add "Add SSO support with Google and Okta, admin configuration UI, and audit logs." .

# Accept/reject interactively when prompted
```

Useful variants:

```sh
# Add multiple requests in one pass
ndx rex add "Request A" "Request B" .

# Import ideas from a text file
ndx rex add --file=ideas.txt .

# Add under a specific parent item
ndx rex add "Add retries to this flow" --parent=<item-id> .
```

If smart add detects duplicates against existing PRD items in your accepted proposals, you’ll get:

```text
Choose action: c=cancel / m=merge with existing / p=proceed anyway
```

- `c` (Cancel): write nothing.
- `m` (Merge): update matched existing items and add only non-duplicate nodes.
- `p` (Proceed anyway): create duplicates and stamp `overrideMarker` on those new duplicate-created items.

Audit visibility:
- `ndx rex status` shows `[override: <reason>]` next to items with override markers.
- `ndx rex status --format=json` includes per-item `overrideMarker` plus a top-level `overrideMarkers` summary.

### D. Remove PRD items (Rex Remove)

Remove epics or tasks that are cancelled, obsolete, or added by mistake:

```sh
# Remove an epic and its entire subtree (features, tasks, subtasks)
rex remove epic <id> .

# Remove a task and its subtasks only (parent feature/epic stays)
rex remove task <id> .

# Auto-detect level from the item ID
rex remove <id> .
```

> **⚠️ WARNING:** Removal is irreversible. Deleted items and all their descendants are permanently erased from `prd.json`. Use `rex status` to review the subtree before removing.

Confirmation behavior:

```sh
# Interactive confirmation prompt (default)
rex remove epic abc123 .
#   Remove epic "My Epic" and 12 descendant(s)? [y/N]

# Skip confirmation for scripting
rex remove task def456 --yes .

# Machine-readable output
rex remove epic abc123 --yes --format=json .
```

Behavior notes:
- **Epic removal** deletes the epic and its entire subtree (features, tasks, and subtasks). Use when an initiative is cancelled or obsolete.
- **Task removal** deletes the task and its subtasks only. The parent feature and epic remain intact. If removing the task causes all remaining siblings to be completed, the parent is auto-completed.
- **Features and subtasks** cannot be removed directly. Remove the parent epic or task instead.
- All `blockedBy` references pointing to deleted items are automatically cleaned up.

### E. Execute PRD tasks autonomously (Hench via ndx work)

**Claude:**

```sh
# Safe first run: one task (uses default model; API key auto-detected from env or config)
ndx work --auto --iterations=1 .

# Specify model explicitly
ndx work --auto --iterations=1 --model=claude-opus-4-20250514 .

# Scale up
ndx work --auto --iterations=4 .

# Scope execution to one epic
ndx work --epic="Your Epic Title" --auto --iterations=2 .

# Force API mode (requires llm.claude.api_key or ANTHROPIC_API_KEY)
ndx config hench.provider api .
ndx work --auto --iterations=1 .
```

**Codex:**

```sh
# Safe first run: one task
ndx work --auto --iterations=1 --model=gpt-5.3-codex .

# Then scale up
ndx work --auto --iterations=4 --model=gpt-5.3-codex .

# Or scope execution to one epic
ndx work --epic="Your Epic Title" --auto --iterations=2 --model=gpt-5.3-codex .
```

### F. Inspect progress and repeat

```sh
ndx status .
ndx sourcevision analyze .
ndx rex recommend .
```

Repeat the loop:
1. SourceVision analyze
2. Rex recommend / add
3. Hench execute with `ndx work`

## Packages

**[sourcevision](packages/sourcevision)** — Static analysis: file inventory, import graph, zone detection (Louvain community detection), React component catalog. Produces `.sourcevision/CONTEXT.md` and `llms.txt` for AI consumption. Includes an interactive browser-based viewer.

**[rex](packages/rex)** — PRD management: hierarchical epics/features/tasks/subtasks, `analyze` scans project + sourcevision output to generate proposals, `status` shows completion tree. Stores state in `.rex/prd.json`. MCP server for AI tool integration.

**[hench](packages/hench)** — Autonomous agent: picks next rex task, builds a brief, calls Claude API or CLI in a tool-use loop with security guardrails, records runs in `.hench/runs/`.

**[@n-dx/llm-client](packages/llm-client)** — Vendor-neutral LLM foundation: shared provider interfaces, Claude and Codex adapters, provider registry, and token usage tracking. Used by rex and hench for all LLM calls.

**[@n-dx/web](packages/web)** — Dashboard and unified MCP HTTP server: browser-based project dashboard with sourcevision zone maps and PRD status, plus a single HTTP endpoint serving both rex and sourcevision MCP tools.

## Command Aliases

Both `n-dx` and `ndx` work identically. Examples in this doc use `ndx` for brevity.

| Full Form | Short Form |
|-----------|------------|
| `n-dx` | `ndx` |
| `sourcevision` | `sv` |

## Orchestration Commands

```
ndx init [dir]             sourcevision init + rex init + hench init
ndx config llm.vendor ...  set active LLM vendor (claude|codex)
ndx plan [dir]             sourcevision analyze + rex analyze (show proposals)
ndx plan --accept [dir]    ...then accept proposals into PRD
ndx plan --file=<path>     import PRD from a document (skips sourcevision)
ndx work [dir]             hench run (interactive task selection by default)
ndx work --auto [dir]      autoselect highest-priority task
ndx work --iterations=N    run N tasks sequentially (stops on failure)
ndx status [dir]           rex status (pass --format=json)
```

## `ndx refresh`

Use `ndx refresh` to update dashboard data and UI artifacts with explicit per-step status output.

```sh
# Full refresh (SourceVision analyze + dashboard artifact metadata + web build)
ndx refresh .

# Scope controls
ndx refresh --data-only .      # Skip UI build
ndx refresh --ui-only .        # Skip SourceVision data refresh
ndx refresh --pr-markdown .    # Regenerate PR markdown only
ndx refresh --no-build .       # Skip web build step
```

Behavior notes:
- Each planned step prints transitions with the step name: `started`, `succeeded`, `failed`, or `skipped`.
- A final refresh step summary is always printed.
- If a running `ndx start` server supports reload signaling, refreshed assets are applied via live reload.
- If live reload signaling is unavailable for a running server (unsupported endpoint or request failure), refresh prints:
  - `Restart required: ndx start stop "<dir>" && ndx start "<dir>"`

## Rex/Hench Vendor Behavior

Use this matrix when choosing `llm.vendor` for `rex analyze` and `hench run`.

| Vendor | Rex behavior | Hench behavior | Token accounting | Known parsing constraints / fallback behavior |
|--------|--------------|----------------|------------------|----------------------------------------------|
| `claude` | Uses the shared LLM client. Auto-selects API when a Claude API key is configured; otherwise falls back to Claude CLI. | Supports both `hench.provider=api` and `hench.provider=cli`. | **Rex:** supported when provider returns usage. **Hench:** supported in API and CLI modes (per-turn + run totals). | JSON responses are expected for structured analyze flows. Parser strips fences/prose and attempts truncated-JSON repair before failing. |
| `codex` | Uses Codex CLI adapter (`codex exec`) only. | CLI-only in Hench (`hench.provider=api` is rejected when `llm.vendor=codex`). | **Rex:** limited (Codex CLI adapter returns text without usage payload). **Hench:** supported when Codex returns usage fields; otherwise zeros with warning. | Rex parse path still expects JSON for structured proposal outputs. Hench applies `normalizeCodexResponse` and tolerates malformed payloads by falling back to plain text; warns on unknown/missing block types and missing usage. |

Vendor selection and related config:
- `ndx config llm.vendor claude .` or `ndx config llm.vendor codex .`
- `ndx config hench.provider cli .` or `ndx config hench.provider api .` (API requires `llm.vendor=claude`)
- `ndx config llm.claude.cli_path /path/to/claude .`
- `ndx config llm.codex.cli_path /path/to/codex .`
- `ndx config llm.claude.model <model> .`
- `ndx config llm.codex.model <model> .`

## Direct Tool Access

Access individual tools through the orchestrator or as standalone commands:

```sh
# Via orchestrator (ndx delegates to the tool)
ndx rex <command> [args]
ndx hench <command> [args]
ndx sourcevision <command> [args]
ndx sv <command> [args]           # shorthand for sourcevision

# Standalone binaries (also available after npm link)
rex <command> [args]
hench <command> [args]
sourcevision <command> [args]
sv <command> [args]               # shorthand for sourcevision
```

## MCP Servers

Rex and sourcevision expose MCP servers for Claude Code tool use:

```sh
# Using standalone binaries (recommended)
claude mcp add rex -- rex mcp .
claude mcp add sourcevision -- sv mcp .

# Or using node directly
claude mcp add rex -- node packages/rex/dist/cli/index.js mcp .
claude mcp add sourcevision -- node packages/sourcevision/dist/cli/index.js mcp .
```

## Development

```sh
pnpm build          # build all packages
pnpm test           # test all packages
pnpm typecheck      # typecheck all packages
```

## Output Files

| Directory | Owner | Contents |
|-----------|-------|----------|
| `.sourcevision/` | sourcevision | `manifest.json`, `inventory.json`, `imports.json`, `zones.json`, `components.json`, `llms.txt`, `CONTEXT.md` |
| `.rex/` | rex | `prd.json`, `config.json`, `execution-log.jsonl`, `workflow.md` |
| `.hench/` | hench | `config.json`, `runs/` |

## License

ISC
