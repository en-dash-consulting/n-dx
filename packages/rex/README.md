# @n-dx/rex

> **This is an internal package of [`@n-dx/core`](https://www.npmjs.com/package/@n-dx/core).** Install `@n-dx/core` instead — it includes this package and registers all CLI commands.

<img src="Rex.png" alt="Rex" width="128">

PRD management and implementation workflow CLI. Rex maintains a structured product requirements document as a tree of epics, features, tasks, and subtasks, then exposes that tree to both humans (CLI) and AI agents (MCP server) so work gets tracked from planning through completion.

## Install

```bash
npm install -g @n-dx/core
# or
pnpm add -g @n-dx/core
# or
yarn global add @n-dx/core
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
| `status` | `pending` \| `in_progress` \| `completed` \| `failing` \| `deferred` \| `blocked` \| `deleted` | yes |
| `level` | `epic` \| `feature` \| `task` \| `subtask` | yes |
| `description` | string | no |
| `acceptanceCriteria` | string[] | no |
| `priority` | `critical` \| `high` \| `medium` \| `low` | no |
| `tags` | string[] | no |
| `source` | string | no |
| `blockedBy` | string[] (item IDs) | no |
| `branch` | string | no |
| `sourceFile` | string | no |
| `children` | PRDItem[] | no |

The PRD document wraps items in:

```json
{
  "schema": "rex/v1",
  "title": "Project Name",
  "items": [ ... ]
}
```

See `docs/prd-markdown-schema.md` for the full list of rex/v1 fields (timestamps, work intervals, token usage, resolution metadata, structured requirements, provenance markers, and passthrough).

## Storage

### `prd.md` is primary

The canonical, human-editable PRD document is `.rex/prd.md`. It uses the **rex/v1 markdown schema** defined in `packages/rex/docs/prd-markdown-schema.md`: a YAML front-matter block, an H1 document title, and one heading per item (H2 = epic, H3 = feature, H4 = task, H5 = subtask). Each item carries a fenced ```` ```rex-meta ```` YAML block with its structured fields, followed by prose that becomes the item's `description`.

```markdown
---
schema: rex/v1
---

# My Project

## Authentication

​```rex-meta
id: "550e8400-e29b-41d4-a716-446655440000"
level: epic
status: pending
priority: high
tags:
  - backend
  - auth
​```

Short prose description for the epic.

### Login UI

​```rex-meta
id: "..."
level: feature
status: in_progress
priority: high
​```
```

### Dual-write to `prd.json`

Every write goes through `FileStore.saveDocument()`, which writes **both** files atomically:

1. `.rex/prd.json` — canonical JSON tree (written first, via `atomicWriteJSON`).
2. `.rex/prd.md` — rex/v1 markdown (written second, via `atomicWrite` + `serializeDocument`).

`prd.md` is the **primary read surface**. `loadDocument()` reads `prd.md` first when it exists; `prd.json` is retained as a derived sync artifact for consumers that still expect structured JSON (e.g., legacy tools, external dashboards) and as a fallback when `prd.md` is absent.

### Automatic migration

When a project is upgraded from a prior JSON-only layout, no manual step is required:

1. The first `loadDocument()` call sees only `.rex/prd.json`.
2. It validates the JSON, serializes it with the markdown writer, and saves the result to `.rex/prd.md`.
3. Subsequent reads load directly from `.rex/prd.md`; writes dual-write to both files.

The migration is idempotent. Any read-only command (`rex status`, `ndx status`) triggers it cleanly on first upgrade.

### Manual migration (`rex migrate-to-md`)

If you want to generate `prd.md` explicitly — for example to inspect the markdown before enabling dual-write writers in parallel — run:

```bash
rex migrate-to-md              # current directory
rex migrate-to-md ./myproject
```

The command:

- Reads `.rex/prd.json`, validates it, and serializes to rex/v1 markdown.
- Re-parses the generated markdown and cross-checks it round-trips back to the source tree. If any field fails to round-trip (timestamps, empty arrays, passthrough) the command aborts with an actionable error and writes nothing.
- Leaves `prd.json` untouched.
- Refuses to overwrite an existing `prd.md` (rename or delete it first to regenerate).

### Reading and editing `prd.md` by hand

`prd.md` is designed to be diffed, reviewed, and edited in the same tools you use for the rest of the repository. When editing by hand:

- **Heading depth is authoritative** for the item level. The `level:` key inside `rex-meta` is written for validation but the parser trusts the heading depth. Moving a heading between levels reparents the item in the tree.
- **Required fields per item:** `id` (UUID, quoted), `level`, `status`, plus a title in the heading text. Everything else is optional and may be omitted when absent.
- **Optional fields** include `priority`, `tags`, `source`, `blockedBy`, `branch`, `sourceFile`, timestamp fields (`startedAt`, `completedAt`, `endedAt`), `activeIntervals`, `acceptanceCriteria`, `loe*`, `tokenUsage`, `duration`, resolution metadata, `requirements`, `overrideMarker`, and `mergedProposals`. Omit a key entirely rather than writing `null`.
- **Description prose** is the markdown text between the `rex-meta` block and the next heading at the same or shallower depth. Leading and trailing blank lines are stripped on parse.
- **Unknown item fields** are preserved under `_passthrough` inside the `rex-meta` block. Do not promote them to top-level keys by hand.
- After editing, run `rex validate` to confirm the document still satisfies the schema, then `rex status` to view the resulting tree.

See `packages/rex/docs/prd-markdown-schema.md` for the full field reference, YAML quoting rules, and round-trip invariants.

## Project structure

```
.rex/
  config.json           Project configuration
  prd.md                PRD tree (primary, human-editable)
  prd.json              Derived JSON sync artifact (dual-written on every save)
  execution-log.jsonl   Append-only structured log (current)
  execution-log.1.jsonl Rotated backup (older entries)
  workflow.md           Agent workflow instructions
```

### PRD file layout

`.rex/prd.md` is the primary PRD document. `.rex/prd.json` is generated from the same in-memory tree on every save and kept in lockstep for compatibility readers. There are no branch-scoped or multi-file writers in the current layout.

![img_here](img_here)

*Figure placeholder — replace `img_here` with the final image path. The diagram should depict the dual-write relationship: rex's `FileStore.saveDocument()` emits both `.rex/prd.md` (primary, human-editable) and `.rex/prd.json` (derived sync artifact) from a single in-memory `PRDDocument`, with `loadDocument()` preferring `prd.md` and falling back to migrating `prd.json` when only JSON is present.*

**Legacy migration.** If the directory still contains branch-scoped files from a very early layout:

```
.rex/
  prd_main_2025-11-02.json
  prd_feature-auth_2025-11-08.json
```

the first store resolution after upgrade merges their items into `prd.json` in source order, renames the originals to `<name>.backup.<timestamp>`, and then generates `prd.md` on the next read:

```
.rex/
  prd.md                                          (generated)
  prd.json                                        (merged)
  prd_main_2025-11-02.json.backup.1729728000000
  prd_feature-auth_2025-11-08.json.backup.1729728000000
```

The migration is idempotent — subsequent reads are no-ops once only `prd.md` + `prd.json` remain. ID collisions across legacy files surface as an error for manual resolution. No user action is required; delete the `.backup.*` files once the merged tree looks correct.

To settle the migration cleanly on first upgrade, run a read-only command (e.g. `rex status` or `ndx status`) once before kicking off parallel PRD writers.

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

## Commit Message Trailers

When hench (the autonomous agent) commits work on a PRD task, it appends structured git trailers to the commit message that link the commit back to the PRD context. These trailers are compatible with `git interpret-trailers` and render as clickable links on GitHub.

### Trailer format

```
feat: update authentication flow

N-DX-Status: task-abc-123 in_progress → completed
N-DX: claude/claude-opus-4-7 · run 550e8400-e29b-41d4-a716-446655440000
N-DX-Item: https://dashboard.example.com/#/rex/item/task-abc-123
```

### Trailers

| Trailer | Purpose | When present |
|---------|---------|--------------|
| `N-DX-Status` | Task status transition (if status changed) | When the commit marks a task as completed |
| `N-DX` | Authorship audit: vendor, model, and run ID | Always (identifies the agent that created the commit) |
| `N-DX-Item` | Dashboard permalink to the PRD task | Always (when task ID is available) |

### N-DX-Item URL configuration

The dashboard base URL for the `N-DX-Item` trailer is resolved from `.n-dx.json`:

```json
{
  "web": {
    "publicUrl": "https://dashboard.example.com"
  }
}
```

When `web.publicUrl` is not configured, defaults to `http://localhost:3117` (the standard local development server URL).

The full URL is constructed as: `<publicUrl>/#/rex/item/<taskId>`

### Handling misconfigured or unreachable URLs

If `web.publicUrl` is misconfigured or unreachable:
- The `N-DX-Item` trailer is still emitted with the configured URL
- A warning is logged, but the commit is not blocked
- Reviewers can manually visit the dashboard if needed

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
