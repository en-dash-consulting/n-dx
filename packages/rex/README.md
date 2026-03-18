# @n-dx/rex

> **This is an internal package of [`@n-dx/core`](https://www.npmjs.com/package/@n-dx/core).** Install `@n-dx/core` instead — it includes this package and registers all CLI commands.

<img src="Rex.png" alt="Rex" width="128">

PRD management and implementation workflow CLI. Rex maintains a structured product requirements document as a tree of epics, features, tasks, and subtasks, then exposes that tree to both humans (CLI) and AI agents (MCP server) so work gets tracked from planning through completion.

## Install

```bash
npm install -g rex
# or link locally
npm link
```

## Quick start

```bash
rex init myproject
rex add epic myproject --title="Authentication"
# note the ID printed, e.g. abc-123
rex add feature myproject --title="Login UI" --parent=abc-123 --priority=high
rex status myproject
rex next myproject
```

## Commands

### `rex init [dir]`

Create `.rex/` in the target directory with skeleton config, empty PRD, execution log, and default workflow.

```bash
rex init              # current directory
rex init /path/to/project
```

Idempotent -- re-running on an existing project is safe.

### `rex add <level> [dir]`

Add an item to the PRD. Level is one of `epic`, `feature`, `task`, `subtask`.

```bash
rex add epic --title="Payments"
rex add feature --title="Checkout Flow" --parent=<epic-id> --priority=high
rex add task --title="Validate card" --parent=<feature-id> --description="Luhn check"
```

Features require an epic parent, tasks require a feature parent, subtasks require a task parent.

**Flags:** `--title` (required), `--parent=<id>`, `--description`, `--priority=<critical|high|medium|low>`, `--status=<pending|in_progress|completed|deferred|blocked>`, `--format=json`

#### Smart add duplicate handling

When you use smart add (`rex add "..."` or `rex add --file=...`) and accepted proposal nodes match existing PRD items, rex shows:

```text
Duplicate matches were detected in the selected proposals.
Choose action: c=cancel / m=merge with existing / p=proceed anyway
Duplicate action (c/m/p):
```

Cancel flow:

```bash
rex add "Add OAuth callback handler" .
# Duplicate action (c/m/p): c
# -> Cancelled. No items were created.
```

Merge flow:

```bash
rex add "Improve OAuth callback handling and retry behavior" .
# Duplicate action (c/m/p): m
# -> Matched existing items are updated
# -> Only non-duplicate nodes are created
```

Proceed anyway flow:

```bash
rex add "Add OAuth callback handler" .
# Duplicate action (c/m/p): p
# -> Duplicate nodes are still created
# -> New duplicate-created items persist override metadata
```

Input safety: empty or invalid duplicate action input defaults to `cancel`.

#### Duplicate audit metadata

When you choose `p` (proceed anyway), each force-created duplicate item gets an `overrideMarker` object in `.rex/prd.json`.

When you choose `m` (merge), matched existing items record `mergedProposals` entries in `.rex/prd.json`.

Where this appears:
- `rex status` tree output shows `[override: <reason>]` next to items that have `overrideMarker`.
- `rex status --format=json` includes:
  - per-item `overrideMarker` fields on affected items
  - top-level `overrideMarkers` summary block (`totalItems`, `overrideCreated`, `normalOrMerged`, `items`)

### `rex update <id> [dir]`

Update an existing item.

```bash
rex update <id> --status=completed
rex update <id> --priority=critical --title="New title"
```

**Flags:** `--status`, `--priority`, `--title`, `--description`, `--format=json`

### `rex status [dir]`

Print the PRD tree with status icons and completion stats.

```
PRD: My Project

○ Authentication [high] [1/3]
  ○ Login UI [high]
    ● Validate email
    ○ Handle errors
    ○ Password reset
◐ Dashboard [0/2]
  ◐ Charts
  ○ Export

2 completed, 1 in progress, 4 pending — 28% complete (2/7)
```

Icons: `○` pending, `◐` in progress, `●` completed, `◌` deferred, `⊘` blocked.

**Flags:** `--format=json` outputs the full PRDDocument.

### `rex next [dir]`

Print the next actionable task. Searches depth-first by priority, skipping completed/deferred/blocked items and items with unresolved `blockedBy` dependencies.

```
Authentication → Login UI →
  [task] Validate email (abc-123) [pending] [high]
  Luhn check on card number
  Acceptance criteria:
    - Rejects invalid card numbers
    - Accepts valid Visa/MC/Amex
```

**Flags:** `--format=json`

### `rex validate [dir]`

Check PRD integrity: schema validation, version check, DAG validation (duplicate IDs, self-references, orphan blockedBy, cycles).

```bash
rex validate myproject
```

Exits with code 1 on failure. `--format=json` for structured output.

### `rex recommend [dir]`

Get SourceVision-based recommendations. Requires a `.sourcevision/` directory from a prior SourceVision analysis.

```bash
rex recommend myproject
rex recommend --accept myproject   # add recommendations to PRD
```

**Flags:** `--accept`, `--format=json`

### `rex analyze [dir]`

Scan the project's test files, documentation, and SourceVision data to propose PRD items. Reconciles against existing items to avoid duplicates.

```bash
rex analyze myproject              # full scan
rex analyze --lite myproject       # filename-only, skip content parsing
rex analyze --accept myproject     # add proposals to PRD
rex analyze --format=json myproject
```

**Scanners:**
- **Tests** -- finds `*.test.*`, `*.spec.*`, `__tests__/` files. Full mode parses `describe`/`it`/`test` blocks. Lite mode uses filenames only.
- **Docs** -- finds `*.md`, `*.txt`, `*.json`, `*.yaml`. Extracts headings, bullets, title/name fields.
- **SourceVision** -- reads `.sourcevision/zones.json`, `inventory.json`, `imports.json`.

**Flags:** `--lite`, `--accept`, `--format=json`

### `rex mcp [dir]`

Start an MCP (Model Context Protocol) server on stdio. This is how AI agents interact with rex programmatically.

## MCP server

The MCP server exposes seven tools and three resources.

### Tools

| Tool | Description |
|------|-------------|
| `get_prd_status` | PRD title, overall stats, per-epic breakdown |
| `get_next_task` | Next actionable task with parent chain |
| `update_task_status` | Change item status (`id`, `status`) |
| `add_item` | Create a new PRD item with full metadata |
| `get_item` | Get item details and parent chain by ID |
| `append_log` | Write to the execution log |
| `get_capabilities` | Schema version, adapter info, feature flags |

### Resources

| URI | Content |
|-----|---------|
| `rex://prd` | Full PRDDocument as JSON |
| `rex://workflow` | Workflow instructions (markdown) |
| `rex://log` | Last 50 execution log entries |

## Data model

Items form a tree: **epic > feature > task > subtask**. Each item has:

| Field | Type | Required |
|-------|------|----------|
| `id` | string (UUID) | yes |
| `title` | string | yes |
| `status` | `pending` \| `in_progress` \| `completed` \| `deferred` \| `blocked` | yes |
| `level` | `epic` \| `feature` \| `task` \| `subtask` | yes |
| `description` | string | no |
| `acceptanceCriteria` | string[] | no |
| `priority` | `critical` \| `high` \| `medium` \| `low` | no |
| `tags` | string[] | no |
| `source` | string | no |
| `blockedBy` | string[] (item IDs) | no |
| `children` | PRDItem[] | no |

The PRD document (`prd.json`) wraps items in:

```json
{
  "schema": "rex/v1",
  "title": "Project Name",
  "items": [ ... ]
}
```

## Project structure

```
.rex/
  config.json           Project configuration
  prd.json              PRD tree
  execution-log.jsonl   Append-only structured log (current)
  execution-log.1.jsonl Rotated backup (older entries)
  workflow.md           Agent workflow instructions
```

### Execution log rotation

The execution log (`execution-log.jsonl`) uses automatic size-based rotation to prevent unbounded growth.

| Parameter | Value | Notes |
|-----------|-------|-------|
| Max file size | 1 MB (1,048,576 bytes) | Checked before each append |
| Max file count | 2 | Current log + one backup |
| Rotation trigger | Pre-append size check | If current log >= 1 MB, rotate before writing |
| Max entry detail | 2,000 characters | Longer `detail` fields are truncated with `...` |

**How rotation works:**

1. Before each `appendLog` call, the current log file size is checked.
2. If it exceeds 1 MB, `execution-log.jsonl` is renamed to `execution-log.1.jsonl` (overwriting any previous backup).
3. The new entry is then written to a fresh `execution-log.jsonl`.

**Which file is authoritative?**

`execution-log.jsonl` is always the current, authoritative log. It contains the most recent entries and is the only file read by `readLog()` and the `rex://log` MCP resource. `execution-log.1.jsonl` is a backup of older entries kept for manual inspection only — it is not read by any rex API.

These values are hardcoded in `FileStore` (`src/store/file-adapter.ts`), not configurable via `config.json`.

## Default workflow

Rex ships with an opinionated workflow for AI agents:

1. Validate the project, fix and commit if broken
2. `get_next_task` -- if nothing, report complete and exit
3. Read full task context
4. Implement with TDD: failing test, green, refactor
5. Run validation and tests
6. `update_task_status` to mark complete
7. `append_log` with decisions and issues
8. Commit
9. Exit after one task

One task per execution, no exceptions.

## Development

```bash
npm install
npm run build       # tsc
npm test            # vitest
npm run dev         # tsc --watch
npm run validate    # typecheck + test
```

## License

ISC
