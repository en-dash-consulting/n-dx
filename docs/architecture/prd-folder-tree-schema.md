# PRD Folder Tree Schema

Normative contract for the serializer (PRD → folder tree) and parser (folder tree → PRD) implementations. This is the sole authoritative PRD storage format; `.rex/prd.md` and `.rex/prd.json` are legacy migration sources (absent after running `rex migrate-to-folder-tree`).

---

## Directory Layout

Tree root: `.rex/prd_tree/` (configurable). Within it, the PRD hierarchy maps to nested directories. Every PRD item — epic, feature, task, or branch subtask — gets its own slug-named folder containing a single `index.md` content file. Leaf subtasks (Rule 1b) are bare `<slug>.md` files inside their parent task's folder.

```
.rex/prd_tree/
├── {epic-slug}/
│   ├── index.md                       ← epic content (required)
│   └── {feature-slug}/
│       ├── index.md                   ← feature content (required)
│       └── {task-slug}/
│           ├── index.md               ← task content (required)
│           ├── {leaf-subtask-slug}.md ← leaf subtask (no children, Rule 1b)
│           └── {branch-subtask-slug}/
│               ├── index.md           ← branch subtask content
│               └── {grandchild-slug}.md ← recursive nesting
└── …
```

**Rules:**
- **Folder items (epic / feature / task / branch subtask):** Each item maps to exactly one slug-named directory containing exactly one `index.md`. The `index.md` holds the item's YAML frontmatter, requirements body, and a `## Children` table linking to direct children. There is no `<title>.md` companion file.
- **Leaf subtasks (Rule 1b):** A subtask with no children is stored as a single bare `<slug>.md` file inside its parent task's folder. The leaf file carries only its own frontmatter (no `__parent*` fields, no inherited parent metadata).
- **Atomic promotion (Rule 2):** When a leaf `<slug>.md` subtask gains its first child, the file's content is moved into a new folder taking the leaf's place: `<slug>.md` → `<slug>/index.md`. The new folder follows Rule 1.
- **Migration with backup (Rule 3):** `ndx reshape` and `ndx add` create a timestamped snapshot of `.rex/prd_tree/` under `.rex/.backups/prd_tree_<ISO>/` before mutating, then run a structural migration that normalizes any legacy shapes (bare `<title>.md` files, `<title>.md` + `index.md` dual-write, single-child compaction shims, phantom `index-{hash}/` wrappers) into the canonical form above. The migration is data-preserving — when it cannot determine intent it leaves the file in place rather than discarding data.
- **Reads accept legacy shapes:** The parser still reads `<title>.md` (legacy single-content file), `__parent*`-shimmed children (single-child compaction), and `## Subtask:` sections (legacy task body) so existing checkouts load without error. The serializer always emits the canonical shape, so a single load+save cycle re-writes the tree to the current contract.
- Nesting depth encodes level: epics at depth 1, features at depth 2, tasks at depth 3, subtasks at depth 4+. Skip-level placements (e.g. a task placed directly under an epic with no intermediate feature) are legal and round-trip without re-typing the item.

---

## Naming Convention

### Slug Algorithm

Every directory name is derived deterministically from the item's **title** and, when needed, **ID**.

| Step | Operation |
|------|-----------|
| 1 | Unicode-normalize the title using NFKD decomposition |
| 2 | Strip combining characters (U+0300–U+036F and Unicode category M) |
| 3 | Remove any remaining non-ASCII characters |
| 4 | Lowercase |
| 5 | Replace each whitespace run with a single hyphen |
| 6 | Remove all characters outside `[a-z0-9-]` |
| 7 | Collapse consecutive hyphens to one |
| 8 | Strip leading and trailing hyphens |
| 9 | If the result is empty, use `untitled` |
| 10 | Reserve room for the id suffix and truncate the title body to fit within 40 characters at a hyphen boundary |
| 11 | Append `-{id6}` where `id6 = id.replace(/[^a-z0-9]/g, "").slice(0, 6)` — **unconditionally, for every item** |

Every slug is id-qualified. Title-only slugs (the pre-collaboration scheme, where the suffix appeared only for long titles or same-tree sibling collisions) let same-titled items created on divergent branches collide on identical paths, so a git merge silently unified two distinct items; the unconditional suffix makes paths collision-free across branches, and renames keep an item recognizable by its suffix. Trees written under the old scheme are renamed in one deliberate pass by `rex migrate-slugs` (idempotent — a second run is a no-op). If a malformed PRD contains duplicate title/ID pairs under the same parent, the serializer appends a final positional suffix to keep the migration lossless.

### Examples

| Title | ID prefix | Slug |
|-------|-----------|------|
| `Web Dashboard` | `4d62fa6c` | `web-dashboard-4d62fa` |
| `Hot-reload MCP tool schemas on HTTP transport without server restart` | `5dd63e4e` | `hot-reload-mcp-tool-schemas-on-5dd63e` |
| `Héros & Légendes` | `a1b2c3d4` | `heros-legendes-a1b2c3` |
| `日本語タイトル` | `f0e1d2c3` | `untitled-f0e1d2` |
| `--- !!!` | `11223344` | `untitled-112233` |

**Long-title trace** (`Hot-reload MCP…`):
- After title normalization: `hot-reload-mcp-tool-schemas-on-http-transport-without-server-restart`
- The serializer reserves room for `-5dd63e` (every slug carries the suffix)
- Prefix limit before suffix: 33 characters
- Body after boundary truncation: `hot-reload-mcp-tool-schemas-on`
- Final slug: `hot-reload-mcp-tool-schemas-on-5dd63e`

### Collision Resistance

The `{id6}` suffix is derived from sanitized PRD IDs and applied to every slug. Uniqueness therefore does not depend on titles at all: two items may share a title — across branches, or as siblings — and still serialize to distinct paths. Six hex-ish characters of a UUID keep the accidental-collision probability negligible at PRD scale; in the pathological case of two items whose ids share their first six safe characters under the same parent, the positional dedup suffix still keeps their directories distinct.

---

## Title-to-Filename Normalization (legacy)

> **Status:** Deprecated as the storage filename rule. The current schema
> uses `index.md` for folder items and `<slug>.md` (slug-style, hyphens) for
> leaf subtasks. `titleToFilename` is retained as a public utility so legacy
> trees and migration code can still rename historical files; new
> serialization paths must not depend on it.

A separate normalization function converts item titles to filesystem-safe filenames. Filenames use underscores for word boundaries (not hyphens) and apply idempotent round-trip normalization.

### Rules

1. Remove `.md` extension if already present (ensures round-trip idempotence)
2. Unicode-normalize using NFKD decomposition (decomposes accented characters)
3. Strip combining diacritical marks (U+0300–U+036F)
4. Lowercase
5. Remove remaining non-ASCII characters for predictable cross-platform checkout
6. Remove filesystem-reserved and punctuation characters
7. Replace whitespace runs with single underscore
8. Strip leading/trailing underscores
9. If the result is empty (all characters removed), use "unnamed"
10. Truncate the filename body at a word boundary so the full filename is <= 40 characters including `.md`
11. Append `.md` extension

### Properties

- **Deterministic:** Same title always produces the same filename
- **Round-trip safe:** `f(f(x)) = f(x)` — applying the function twice yields the same result as applying once
- **Idempotent:** Already-normalized filenames are not changed
- **Collision-prone inputs merge:** Titles differing only in punctuation normalize to the same filename
- **Length capped:** Filenames are capped at 40 characters including `.md` to keep nested `.rex/prd_tree` paths below Windows checkout limits

### Examples

| Title | Normalized Filename |
|-------|---------------------|
| `Web Dashboard` | `web_dashboard.md` |
| `My: Title? (test)` | `my_title_test.md` |
| `web_dashboard.md` | `web_dashboard.md` |
| `  spaces  ` | `spaces.md` |
| `!!!???` | `unnamed.md` |
| `Héros & Légendes` | `heros_legendes.md` |
| `Hello World` | `hello_world.md` |
| `Hello: World` | `hello_world.md` |
| `Hello (World)` | `hello_world.md` |
| `This is a very long title with many words that should all be preserved` | `this_is_a_very_long_title_with_many.md` |

### Public API

```typescript
export function titleToFilename(title: string): string
```

Exported from `rex` package at `rex.titleToFilename()`. Used by the folder-tree serializer to generate markdown filenames from item titles, and by migration commands to rename legacy `index.md` files.

---

## Per-Item Markdown File Schema

Every per-item markdown file — `index.md` for folder items, `<slug>.md` for leaf subtasks — begins with a YAML frontmatter block, followed by Markdown body content. **Bold** = required.

### Common Fields (All Levels)

```yaml
---
id:               # string  REQUIRED — full UUID
level:            # string  REQUIRED — epic | feature | task
title:            # string  REQUIRED — human-readable title
status:           # string  REQUIRED — pending | in_progress | completed | failing | deferred | blocked | deleted
description:      # string  REQUIRED — may be empty string ("")
priority:         # string  optional — critical | high | medium | low
tags:             # list    optional — list of strings
source:           # string  optional — origin hint (smart-add | analyze | manual)
startedAt:        # string  optional — ISO 8601 timestamp
completedAt:      # string  optional — ISO 8601 timestamp
endedAt:          # string  optional — ISO 8601 timestamp
resolutionType:   # string  optional — code-change | config-override | acknowledgment | deferred | unclassified
resolutionDetail: # string  optional — prose description of resolution
failureReason:    # string  optional — present when status is failing
---
```

### Epic-Level Fields

No additional fields. Epics are containers; detail lives in descendants.

### Feature-Level Fields (additional)

```yaml
acceptanceCriteria:   # list    REQUIRED — may be empty list ([])
  - "Criterion text"
loe:                  # string  optional — xs | s | m | l | xl (level of effort)
```

### Task-Level Fields (additional)

```yaml
acceptanceCriteria:   # list    REQUIRED — may be empty list ([])
  - "Criterion text"
loe:                  # string  optional — xs | s | m | l | xl
```

**`loe` values:** `xs` = < 1 day, `s` = 1–3 days, `m` = 3–5 days, `l` = 1–2 weeks, `xl` = > 2 weeks.

---

## Full Per-Item File Examples

The following examples illustrate the complete schema including all summary sections. Inline `index.md` references inside the example children/links predate the title-named-file rename and should be read as `<child_title>.md`; they are kept verbatim so the example bodies remain valid Markdown.

### Epic: Web Dashboard

```markdown
---
id: "4d62fa6c-ad0d-4e1e-91f8-c2f1ebe696e7"
level: epic
title: "Web Dashboard"
status: completed
startedAt: "2026-03-24T05:27:03.754Z"
completedAt: "2026-04-29T18:36:04.012Z"
description: >-
  Unified web dashboard and MCP HTTP server. Preact-based UI with SourceVision,
  Rex, and Hench views. Provides real-time PRD status, autonomous agent monitoring,
  and integrated analysis tools.
---

# Web Dashboard

⚪ [completed]

## Summary

Unified web dashboard and MCP HTTP server. Preact-based UI with SourceVision,
Rex, and Hench views. Provides real-time PRD status, autonomous agent monitoring,
and integrated analysis tools.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| [Hot-reload MCP tool schemas on HTTP transport without server restart](./hot-reload-mcp-tool-schemas-on-http-5dd63e4e/index.md) | feature | completed | 2026-04-17 |
| [Dashboard Route Ownership Decoupling](./dashboard-route-ownership-decoupling-f89b6b48/index.md) | feature | completed | 2026-04-22 |
| [WebSocket Real-Time Updates](./websocket-real-time-updates-c3d4e5f6/index.md) | feature | completed | 2026-04-29 |

## Info

- **Status:** completed
- **Level:** epic
- **Started:** 2026-03-24T05:27:03.754Z
- **Completed:** 2026-04-29T18:36:04.012Z
- **Duration:** 36d 13h 8m

## Children

| Title | Status |
|-------|--------|
| [Hot-reload MCP tool schemas on HTTP transport without server restart](./hot-reload-mcp-tool-schemas-on-http-5dd63e4e/index.md) | completed |
| [Dashboard Route Ownership Decoupling](./dashboard-route-ownership-decoupling-f89b6b48/index.md) | completed |
| [WebSocket Real-Time Updates](./websocket-real-time-updates-c3d4e5f6/index.md) | completed |
```

**Annotations:**
- Epic has no `## Commits` or `## Changes` sections (only features and tasks accumulate these).
- `## Summary` sourced from `description` field; preserved across regeneration if human-edited.
- `## Progress` shows all direct children with their completion status and last-update dates.
- `## Info` displays high-level metadata (status, level, dates, duration).

### Feature: Hot-reload MCP Tool Schemas

```markdown
---
id: "5dd63e4e-1bbb-47a8-a0fa-754bc142a377"
level: feature
title: "Hot-reload MCP tool schemas on HTTP transport without server restart"
status: completed
priority: low
tags: [web, mcp, dx]
startedAt: "2026-04-17T04:37:35.878Z"
completedAt: "2026-04-17T05:02:17.402Z"
resolutionType: code-change
resolutionDetail: >-
  Implemented file-watching + subprocess proxy hot-reload for MCP tool schemas.
  Three new files + modifications to routes-mcp.ts and start.ts.
acceptanceCriteria:
  - "After rebuilding rex or sourcevision, the HTTP MCP server serves updated tool schemas without manual restart"
  - "No impact on active MCP sessions (new sessions get new schemas, existing sessions continue)"
loe: m
description: >-
  The HTTP MCP server holds tool schemas in memory from startup. When rex or
  sourcevision are rebuilt, the running server still serves old schemas. Users
  must restart the server to pick up changes. This feature implements automatic
  schema reloading via file watchers so the server stays current without restarts.
---

# Hot-reload MCP Tool Schemas on HTTP Transport Without Server Restart

⚪ [completed]

## Summary

The HTTP MCP server holds tool schemas in memory from startup. When rex or
sourcevision are rebuilt, the running server still serves old schemas. Users
must restart the server to pick up changes. This feature implements automatic
schema reloading via file watchers so the server stays current without restarts.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| [Implement file-watch reload trigger](./implement-file-watch-reload-trigger-a1b2c3d4/index.md) | task | completed | 2026-04-17 |
| [Update MCP subprocess proxy](./update-mcp-subprocess-proxy-b2c3d4e5/index.md) | task | completed | 2026-04-17 |

## Commits

- `a3b4c5d6` — Implement file-watch reload trigger for MCP schemas (2026-04-17)
- `b4c5d6e7` — Add subprocess proxy hot-reload handler (2026-04-17)
- `c5d6e7f8` — Update MCP tool schema tests (2026-04-17)

## Changes

- **Status changed:** in_progress → completed (2026-04-17T05:02:17.402Z)

## Info

- **Status:** completed
- **Priority:** low
- **Tags:** web, mcp, dx
- **Level:** feature
- **Started:** 2026-04-17T04:37:35.878Z
- **Completed:** 2026-04-17T05:02:17.402Z
- **Duration:** 24m

## Children

| Title | Status |
|-------|--------|
| [Implement file-watch reload trigger](./implement-file-watch-reload-trigger-a1b2c3d4/index.md) | completed |
| [Update MCP subprocess proxy](./update-mcp-subprocess-proxy-b2c3d4e5/index.md) | completed |
```

**Annotations:**
- Feature is a container but also a work item, so it can have `## Commits` and `## Changes` sections.
- `## Progress` shows the two task children with their completion status.
- `## Commits` lists the 3 most recent commits associated with this feature (discovered via git commit trailers).
- `## Changes` shows the status transition to completed.
- `## Info` includes priority, tags, and duration in addition to basic status/level/dates.
- `## Children` remains for directory structure documentation (same as before).

### Task: Globalize Token Usage Route Ownership

```markdown
---
id: "49975940-0615-48e5-9538-0f3cda2407d3"
level: task
title: "Globalize Token Usage Route Ownership"
status: completed
priority: high
startedAt: "2026-02-22T21:40:06.085Z"
completedAt: "2026-02-22T21:40:06.085Z"
resolutionType: code-change
resolutionDetail: >-
  Moved token-usage endpoint from Rex-scoped routes to global dashboard routes.
  Updated route configuration and sidebar metadata. All tests passing.
acceptanceCriteria:
  - "Token Usage is reachable from global nav without being scoped to Rex"
  - "Routing and UI metadata are consistent with other global dashboard sections"
loe: s
description: >-
  Make Token Usage a first-class global dashboard destination instead of a
  Rex-scoped view so routing and UI metadata remain consistent across sections.
  This involves updating the route registry and removing Rex-specific bindings.
---

# Globalize Token Usage Route Ownership

⚪ [completed]

## Summary

Make Token Usage a first-class global dashboard destination instead of a
Rex-scoped view so routing and UI metadata remain consistent across sections.
This involves updating the route registry and removing Rex-specific bindings.

## Commits

- `a7b8c9d0` — Remove token-usage from Rex view scope registry (2026-02-22)
- `b8c9d0e1` — Register token-usage as global route (2026-02-22)
- `c9d0e1f2` — Update breadcrumb and sidebar metadata (2026-02-22)

## Changes

- **Status changed:** in_progress → completed (2026-02-22T21:40:06.085Z)

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-02-22T21:40:06.085Z
- **Completed:** 2026-02-22T21:40:06.085Z
- **Duration:** < 1m

## Subtask: Remove token-usage from Rex view scope registry

**ID:** `39c0d90c-8a76-4a7a-96e8-ab7b7469433f`
**Status:** completed
**Priority:** critical

Remove the `token-usage` entry from `VIEWS_BY_SCOPE.rex` so route resolution
no longer depends on Rex scope helpers.

**Acceptance Criteria**

- `` `VIEWS_BY_SCOPE.rex` `` no longer contains a `token-usage` entry
- Route resolution for `token-usage` does not depend on Rex scope helpers
- Existing Rex-only views still resolve without regression after the removal

---

## Subtask: Update global route registry

**ID:** `8f8a9b0c-0615-48e5-9538-0f3cda2407d3`
**Status:** completed
**Priority:** high

Register `token-usage` as a global route so the sidebar and breadcrumb system
resolve it correctly.

**Acceptance Criteria**

- `token-usage` appears in the global route table
- Breadcrumb renders "Token Usage" without a Rex prefix
```

**Annotations:**
- Task includes `## Summary`, `## Commits`, `## Changes`, and `## Info` sections like features.
- Task has NO `## Children` section (children are encoded as `## Subtask:` sections instead).
- `## Commits` shows the three commits associated with task completion.
- `## Changes` shows the status transition event.
- `## Info` includes all applicable metadata (status, priority, level, dates, duration).
- Subtask sections follow immediately after `## Info`, before any child structural sections.

---

## index.md Summary Schema

> **Status: designed; not yet implemented by the serializer.** The serializer
> currently writes only the title-named per-item file. Folder-level `index.md`
> aggregation summaries are tracked in the PRD as "Folder-level index.md
> summary aggregation" and will be emitted in addition to (not in place of)
> the per-item file. The schema below is the target contract for that work.

Every folder-level `index.md` file serves as an auto-generated summary of its directory's contents. The body includes extended metadata sections that are regenerated on every PRD write to remain in sync with the underlying PRD state.

### Semantic Contracts

Each body section is classified as either **regenerated** or **preserved**:

- **Regenerated**: Overwritten on every PRD write. The serializer computes these from PRD state (frontmatter, execution log, tree structure).
- **Preserved**: Round-trip safe for human edits. When a human or external process modifies these sections, the serializer respects the changes on the next write.

### Structure

Every `index.md` follows this structure (in order):

```
1. YAML frontmatter        ← required; always regenerated
2. Item display heading    ← required; regenerated
3. Summary section         ← required; preserved (human-editable)
4. Progress section        ← for containers; regenerated
5. Commits section         ← for completed/in-progress items; regenerated
6. Changes section         ← if recent mutations exist; regenerated
7. Info section            ← regenerated
8. Children section        ← for non-leaf items; regenerated (or omit if empty)
9. Subtask sections        ← for tasks; regenerated
```

### Section Details

#### 1. Item Display Heading

**Regenerated**. Provides a prominent display of the item title and key metadata.

```markdown
# {title}

{priority-indicator} {status-badge}
```

**Rules:**
- Heading level 1 (single `#`).
- Priority indicator (only if priority is set): `🔴` (critical), `🟠` (high), `🟡` (medium), `⚪` (low).
- Status badge: `[pending]`, `[in_progress]`, `[completed]`, `[failing]`, `[deferred]`, `[blocked]`, `[deleted]` (markdown code formatting).

**Example:**
```markdown
# Web Dashboard Rewrite

🔴 [in_progress]
```

#### 2. Summary Section

**Preserved**. Contains a prose summary of the item. The serializer initializes this from the `description` field in frontmatter but does NOT overwrite it on regeneration if the section has been edited.

**Heading:** `## Summary`

**Content:**
- First write: value from `description` frontmatter field
- If human-edited: changes survive regeneration
- If `description` is empty: "No summary provided."

**Rules:**
- Plain Markdown prose (no special formatting required).
- If the item has no description and the section is empty, it stays empty on subsequent writes.
- Edits to this section are not reflected back into the frontmatter `description` field (one-way initialization).

**Example:**
```markdown
## Summary

The Web Dashboard is the central hub for PRD management, analysis, and autonomous execution. It aggregates SourceVision analysis, Rex task status, and Hench run history into a unified browser-based interface.
```

#### 3. Progress Section

**Regenerated**. Appears only on non-leaf items (epics and features). Shows completion status of direct children.

**Heading:** `## Progress`

**Format:**

```markdown
## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| [Implement hot-reload](./implement-hot-reload-a1b2c3d4/index.md) | task | completed | 2026-04-29 |
| [Add metrics endpoint](./add-metrics-endpoint-b2c3d4e5/index.md) | task | in_progress | 2026-04-30 |
```

**Columns:**
- **Child:** Linked title (relative path to child folder + `/index.md`)
- **Level:** Child item level (`task`, `feature`)
- **Status:** Current status badge (`pending`, `in_progress`, `completed`, etc.)
- **Last Updated:** ISO date of the most recent status change for this child (from execution log or `completedAt`/`endedAt`)

**Rules:**
- Children listed in PRD insertion order.
- If a non-leaf item has no children, omit this section entirely.
- "Last Updated" is derived from: `completedAt` (if completed), `endedAt` (if status changed), or `startedAt` (if in_progress).
- Fallback to the date portion of the item's `id` timestamp if no status timestamps exist (internal consistency).

#### 4. Commits Section

**Regenerated**. Appears on completed or in-progress tasks. Lists commits attributed to this task via commit trailers or execution log records.

**Heading:** `## Commits`

**Format:**

```markdown
## Commits

- `a3b4c5d6` — Implement hot-reload MCP tool schemas without server restart (2026-04-17)
- `b4c5d6e7` — Add file-watch reload trigger (2026-04-18)
- `c5d6e7f8` — Update hot-reload tests and integration (2026-04-19)
```

**Commit Attribution Rules:**
- Commits are discovered via `N-DX-Status:` trailers in git commit messages (format: `N-DX-Status: {itemId} {fromStatus} → {toStatus}`).
- A commit is attributed to a task if its trailer references the task's ID.
- If no trailers exist, commits are inferred from execution log entries of type `task_completed` or `status_updated` that reference the task. In this case, no specific commit hash is available — the section is omitted.
- Commits listed in reverse chronological order (most recent first).

**Rules:**
- Include up to the 10 most recent commits.
- Fallback to "Commits not yet attributed" if no commits are discovered.
- If the item is not completed or in_progress, omit this section entirely.

#### 5. Changes Section

**Regenerated**. Appears only if the item has recent mutations (within the last 10 changes). Lists the most recent mutations from the execution log.

**Heading:** `## Changes`

**Format:**

```markdown
## Changes

- **Status changed:** in_progress → completed (2026-04-29T19:03:08.925Z)
- **Execution logged:** run completed with 150 tokens (2026-04-29T19:02:50.000Z)
- **Priority updated:** high → critical (2026-04-29T18:00:00.000Z)
```

**Mutation Discovery:**
- Query the execution log (`.rex/execution-log.jsonl`) for entries with `itemId` matching this item's ID.
- Include entries of type: `status_updated`, `status_changed`, `task_completed`, `task_failed`.
- For `status_changed` entries, parse the `detail` field to extract the transition (`{fromStatus} → {toStatus}`).
- For other types, format the detail from the `detail` field (truncated to 100 chars if necessary).

**Rules:**
- Show the 10 most recent mutations.
- Timestamps in ISO 8601 format.
- If no mutations exist, omit this section entirely.
- Format mutation types as bold labels (e.g., `**Status changed:**`).

#### 6. Info Section

**Regenerated**. Displays detailed item metadata.

**Heading:** `## Info`

**Format:**

```markdown
## Info

- **Status:** in_progress
- **Priority:** high
- **Tags:** web, mcp, dx
- **Level:** feature
- **Branch:** main
- **Started:** 2026-04-17T04:37:35.878Z
- **Last Updated:** 2026-04-29T19:03:08.925Z
- **Duration:** 12d 14h 25m
```

**Fields:**
- **Status:** Current status
- **Priority:** If set; otherwise omit
- **Tags:** If set, comma-separated; otherwise omit
- **Level:** Always included
- **Branch:** If set in frontmatter; otherwise omit
- **Started:** If `startedAt` is set; formatted as ISO date or relative time
- **Last Updated:** Most recent timestamp from `completedAt`, `endedAt`, or `startedAt`
- **Duration:** Human-readable interval from `startedAt` to `completedAt` (if both exist); otherwise omit

**Rules:**
- Omit fields that are not set or not applicable.
- Duration calculation: `completedAt - startedAt` (rounded to nearest hour/day).
- Use ISO 8601 timestamps, or human-readable relative times if the UI prefers (e.g., "2 weeks ago").

---

## Recursive Children Summary Block

Every per-item markdown file whose item has direct children **must** include a `## Children` section at the end of the Markdown body. Tasks **never** include this section — their children are subtasks encoded as sections.

### Format

```markdown
## Children

| Title | Status |
|-------|--------|
| [{child title}](./{child-slug}/{child_title}.md) | {status} |
```

**Rules:**
- Children listed in PRD insertion order.
- Relative link: `./` + child directory name + `/` + `<titleToFilename(child.title)>.md`. Legacy fixtures whose links still point at `/index.md` are accepted by the parser, but the serializer always emits the title-named form.
- If a non-leaf item has no children (empty container), omit the `## Children` section entirely.
- The parser **ignores** this section for tree reconstruction — it uses directory nesting as ground truth. The section is informational only.

---

## Subtask Encoding

Subtasks use **dual-mode serialization** depending on whether they have children:

### Leaf Subtasks (No Children)

Leaf subtasks are serialized as `.md` files inside the parent task's
directory:

```
{task-slug}/
├── index.md             ← task content + ## Children table
└── {subtask-slug}.md    ← leaf subtask file (Rule 1b)
```

The leaf subtask `.md` file contains YAML frontmatter (like task-level files) followed by a Markdown body. The schema is identical to the per-item file schema at task level (see [`## Per-Item Markdown File Schema`](#per-item-markdown-file-schema)).

### Branch Subtasks (With Children)

A subtask with children is serialized as a slug-named directory containing
its own `index.md`, following the same folder-per-branch rule recursively:

```
{task-slug}/
├── index.md
└── {subtask-slug}/
    ├── index.md                  ← subtask content + ## Children
    ├── {grandchild-slug}.md      ← leaf grandchild
    └── {grandchild2-slug}/
        ├── index.md
        └── {great-grandchild-slug}.md
```

Branch subtasks follow the exact same directory structure, naming, and file schema as top-level items (epics/features/tasks), allowing arbitrary nesting depth.

### Promotion Rule

The leaf-to-folder transition (Rule 2) is implemented as a side effect of
the parser+serializer round-trip rather than as a dedicated mutation:

1. The caller adds a child to the leaf via `store.addItem(child, leafId)`
   (or any equivalent path: MCP `add_item`, `cmdAdd`, etc.).
2. `addItem` runs `loadDocument` → the parser sees the leaf `<slug>.md`
   and produces an in-memory `PRDItem` with `children: []`. It mutates
   the in-memory tree to attach the new child.
3. `addItem` then runs `saveDocument` → the serializer's `writeSiblings`
   sees `children.length > 0` and switches to the branch shape: it
   `mkdir`s `<slug>/`, writes `<slug>/index.md` from the in-memory item's
   frontmatter (preserving every field), and recurses to write the new
   child as another leaf `<child-slug>.md` (or nested folder).
4. The serializer's `removeStaleEntries` sweep at the parent level
   removes the original `<slug>.md` file: it is no longer in the
   expected-leaf set (the item is now a folder, not a leaf).

The transition is therefore a pure shape change driven by the in-memory
children list — frontmatter is preserved exactly, no `__parent*` shims
are introduced, and the inverse direction (removing the last child of a
branch) collapses the folder back to a bare `<slug>.md` by the same
mechanism. End-to-end behavior is pinned by
`packages/rex/tests/integration/leaf-to-folder-promotion.test.ts`.

There is no standalone "atomic promotion" code path; the whole
transition lands as part of one `saveDocument` call. If the save is
interrupted, recovery uses the snapshot from `.rex/.backups/prd_tree_<ISO>/`
written by `ndx reshape` / `ndx add` (Rule 3).

### Mixed-Mode Containers

A parent task or subtask directory may contain a mix of leaf `.md` files (childless subtasks) and subdirectories (subtasks with children):

```
{task-slug}/
├── index.md                 ← task content + ## Children table
├── {leaf-sub1}.md           ← childless subtask
├── {leaf-sub2}.md           ← childless subtask
├── {branch-sub1}/
│   ├── index.md
│   ├── {grandchild}.md
│   └── {branch-sub2}/
│       └── index.md
└── {leaf-sub3}.md           ← childless subtask
```

The parser handles this naturally by treating `.md` files and directories as leaf/branch subtasks respectively.

### Legacy Subtask Sections (Migration Support)

During migration from the legacy PRD format (where subtasks were encoded as `## Subtask:` sections within the parent task's markdown), the parser may encounter subtask sections in existing `.md` files. These sections are ignored during migration — subtasks are reconstructed from directory nesting only (either as leaf `.md` files or branch directories).

If a legacy task file contains both:
- Subtask sections in the markdown body (legacy)
- Subtask `.md` files or directories in the same parent folder (new format)

The subtask files/folders take precedence; the sections are preserved as informational body content but not parsed as items.

---

## Regeneration Semantics Matrix

This table documents the regeneration behavior for each section:

| Section | Regenerated | Source of Truth | Preservation Policy |
|---------|-------------|-----------------|---------------------|
| Frontmatter | Yes | PRDItem fields | Always overwritten; contains canonical item data |
| Item Display | Yes | title, priority, status | Computed from frontmatter on each write |
| Summary | **No** (preserved) | `description` field (initial value) | First-write from description; human edits survive |
| Progress | Yes | Tree structure + child status | Recomputed from tree on each write |
| Commits | Yes | Execution log + git trailers | Discovered from git history on each write |
| Changes | Yes | Execution log | Last 10 mutations recomputed on each write |
| Info | Yes | Frontmatter + computed dates | Derived from item state on each write |
| Children | Yes | Tree structure | Recomputed from directory nesting on each write |
| Subtasks | Yes | PRDItem.children (task level) | Serialized from child items on each write |

### Decision Rationale

**Why is `## Summary` preserved?**
- The `description` field is often written by humans as prose.
- If the serializer overwrites the summary on every write, humans cannot add elaborative detail beyond the original description (e.g., links, examples, context).
- By preserving the summary, the serializer allows humans to enhance and maintain the section while still initializing it from description on first write.
- The summary is not synced back to the frontmatter description field (one-way initialization).

**Why are other sections regenerated?**
- They derive from PRD state (execution log, tree structure, item fields) that changes frequently.
- Manually editing these sections would be lost on the next write, so preservation would be misleading.
- The serializer makes these sections read-only by design: they are informational, not authoritative.

### Serializer Behavior

When writing an `index.md` file:

1. **Frontmatter:** Always overwritten with current PRDItem state.
2. **Summary:** 
   - If the item is being created or the file does not exist, initialize from `description`.
   - If the file exists and the summary section is present, preserve the existing section (do not overwrite).
   - If the file exists but the summary section is missing, add it from `description`.
3. **All other sections:** Recompute and overwrite with current state.

### Parser Behavior

When reading an `index.md` file:

1. Parse frontmatter as the canonical source of item data.
2. Ignore all body sections except:
   - `## Subtask:` sections (for task-level items) — parse these to reconstruct subtask children.
   - `## Children` — ignored for tree reconstruction (directory structure is authoritative).
3. Ignore Summary, Progress, Commits, Changes, and Info sections — these are informational only.

---

## Serializer Contract

The serializer (PRD → folder tree) must:

1. Compute each item's slug using the algorithm in [Naming Convention](#naming-convention).
2. Create directories at the correct nesting depth under the tree root.
3. **Task-level items:** Always write as a directory containing `<titleToFilename(title)>.md`. For items migrating from bare `.md` files (legacy), create the directory and move the file into it.
4. **Subtask serialization (dual-mode):**
   - **Leaf subtasks** (no children): Write as title-named `.md` files in the parent task directory
   - **Branch subtasks** (with children): Write as directories containing a title-named `.md` file (same rule as task-level items, recursively)
   - **Promotion detection:** If a subtask with children previously existed as a leaf `.md` file, remove the old file and create the new directory structure atomically
5. Write `<titleToFilename(title)>.md` with all required frontmatter fields and a complete body. Remove orphaned per-item `.md` files in the same directory (left over from prior titles, or leaf subtasks that were promoted to branches).
6. **Item Display:** Generate the heading and status badge from title and status.
7. **Summary:** 
   - For new files: initialize from `description` field.
   - For existing files: preserve the existing summary section if present; do not overwrite.
   - If summary is missing and description exists, add it.
8. **Progress:** For non-leaf items with at least one child, generate a table with child title, level, status, and last-updated date.
9. **Commits:** For completed or in-progress items, query git history for commits with `N-DX-Status:` trailers matching this item's ID, and list the 10 most recent. If no commits found, omit this section.
10. **Changes:** Query the execution log for recent mutations (itemId matches this item), and list the 10 most recent. Omit if no mutations exist.
11. **Info:** Generate metadata section with status, priority (if set), tags (if set), level, branch (if set), started/completed dates (if set), and computed duration.
12. **Children:** For non-leaf items with at least one child, append a `## Children` section listing direct children in insertion order. Omit if the item has no children.
13. **Subtasks:** For task items with leaf subtasks, do not generate `## Subtask:` sections. Subtasks are serialized as sibling files/folders, not as sections.
14. Write atomically: build the entire tree into a temp directory, then rename it into place to prevent partial states.
15. Preserve unknown frontmatter fields (round-trip fidelity for future extensions).
16. **Uniqueness enforcement:** Verify that no two sibling items (at any level) have the same slug. If a slug collision is detected, append the item's `-{id6}` suffix (or positional suffix if needed) to resolve it.

---

## Parser Contract

The parser (folder tree → PRD) must:

1. Discover items by traversing the folder tree depth-first:
   - For each directory at depth 1 (epics), depth 2 (features), or depth 3 (tasks): find the unique title-named `.md` file, accepting `index.md` as a legacy fallback. This is the container item.
   - Within depth 3+ directories (task/subtask containers): discover children as both files and subdirectories:
     - **Leaf subtask files:** Title-named `.md` files (e.g., `subtask-one.md`)
     - **Branch subtask directories:** Subdirectories containing a title-named `.md` file
2. Parse the YAML frontmatter from each file to extract structured fields — this is the canonical source of item data.
3. Ignore all Markdown body sections (except legacy support):
   - The `## Summary`, `## Progress`, `## Commits`, `## Changes`, and `## Info` sections are informational only and must not be parsed into item fields.
   - The `## Children` section is informational only; directory structure is authoritative for parent-child relationships.
   - Legacy `## Subtask:` sections may appear in task files migrated from the old format; ignore them (subtasks are now represented as files/folders).
4. **Subtask discovery (dual-mode):**
   - For each `.md` file in a task/subtask directory: treat it as a leaf subtask child (load from frontmatter, no recursive children)
   - For each subdirectory in a task/subtask directory: recursively treat it as a branch subtask container (apply the same tree traversal rules)
5. Infer parent-child relationships from directory nesting depth — a file at `tree/{a}/{b}/{c}/<task_title>.md` is a task `{c}` whose parent is feature `{b}` whose parent is epic `{a}`. Subtasks at `tree/{a}/{b}/{c}/{d}/<subtask_title>.md` or `tree/{a}/{b}/{c}/{d}/` are subtasks of task `{c}`.
6. Reject files with missing required frontmatter fields with a descriptive error identifying the file path and the missing field.
7. Reconstruct items in directory-entry order (alphabetical by slug) within each level, which preserves insertion order because slugs are stable.
8. **Slug-collision detection:** Verify that no two sibling items at the same level have identical slugs. If duplicates are found, report an error with file paths and slugs, or apply the recovery rule from the serializer (append `-{id6}` suffixes) if configured to auto-heal.

---

## Field Summary Table

| Field | Epic | Feature | Task | Subtask (file) | Subtask (folder) |
|-------|------|---------|------|---|---|
| `id` | required | required | required | required | required |
| `level` | required | required | required | subtask | subtask |
| `title` | required | required | required | required | required |
| `status` | required | required | required | required | required |
| `description` | required | required | required | optional | optional |
| `acceptanceCriteria` | — | required | required | optional | optional |
| `loe` | — | optional | optional | — | — |
| `priority` | optional | optional | optional | optional | optional |
| `tags` | optional | optional | optional | — | — |
| `source` | optional | optional | optional | — | — |
| `startedAt` | optional | optional | optional | — | — |
| `completedAt` | optional | optional | optional | — | — |
| `endedAt` | optional | optional | optional | — | — |
| `resolutionType` | optional | optional | optional | — | — |
| `resolutionDetail` | optional | optional | optional | — | — |
| `failureReason` | optional | optional | optional | — | — |
| Storage format | folder when has children, else `.md` | same | same | `.md` file | folder containing `index.md` |
| Inline children | mixed (files + folders) | mixed (files + folders) | mixed (files + folders) | N/A | mixed (files + folders) |
| `## Children` body block | when children exist | when children exist | when children exist | — | when children exist |

---

## Post-Merge Validation

A git merge of the tree can leave corruption no rex code path produces: duplicate IDs (both branches created or moved the same item at different paths), directories whose `index.md` was lost in conflict resolution, files at the wrong nesting depth, `blockedBy` references to items the other branch deleted, and unresolved conflict markers. `rex validate --post-merge` scans the raw tree for all five classes; `--repair` fixes the deterministic ones (empty orphaned directories are removed, `level` is rewritten to the depth-implied value, dangling `blockedBy` ids are dropped) and refuses the ambiguous ones (duplicate IDs, conflict markers, orphaned directories that still contain items) with instructions.

Exit codes are hook-friendly — 0 means clean (including a repo with no PRD tree at all), 1 means issues remain — so it wires directly into an optional git post-merge hook:

```sh
#!/bin/sh
# .git/hooks/post-merge  (chmod +x)
rex validate --post-merge || echo "PRD tree needs attention: run 'rex validate --post-merge --repair'"
```

A post-merge hook cannot abort the merge (it runs after the fact); the exit code exists so CI or wrapper scripts can gate on it. Pair with the `rex-prd` merge driver (registered by `ndx init`), which prevents most of these states from arising in the first place.

## Related Documentation

This schema is the normative storage contract for the PRD folder-tree format. For broader context:

- **CLAUDE.md** (`Key Files` section): Describes `.rex/prd_tree/` as the sole writable PRD surface and references this schema document.
- **AGENTS.md** (Public guidance): Links to this schema for agents implementing PRD operations.
- **Implementation**: The `rex` package implements serialization and parsing according to this schema:
  - `packages/rex/src/store/folder-tree-serializer.ts` — writes files to disk:
    - Branch items (any level with children): folder containing one `index.md` (frontmatter + `## Children` table)
    - Leaf items (any level with no children): bare `<slug>.md` next to the parent's `index.md`
    - Stale-entry cleanup: `removeStaleEntries` removes any folder or `.md` file at the parent level that is no longer in the in-memory expected set, which is what drives leaf↔branch promotion on the next save
  - **Promotion test:** `packages/rex/tests/integration/leaf-to-folder-promotion.test.ts` exercises both directions (leaf→folder when first child added; folder→leaf when last child removed) plus byte-level frontmatter preservation.
  - `packages/rex/src/store/folder-tree-parser.ts` — reads files from disk:
    - `index.md` is the canonical content file inside item folders; legacy `<title>.md` is accepted as a fallback when no `index.md` exists
    - Discovers leaf children as bare `<slug>.md` files at every level (epic, feature, task, branch subtask)
    - Reconstructs items from legacy `__parent*` shims, emitting a deprecation warning each time
  - `packages/rex/src/store/title-to-filename.ts` — implements `titleToFilename` (still exported for legacy migration; the current serializer no longer uses it for content files)
  - `packages/rex/src/core/folder-per-task-migration.ts` — pre-load migration that renames legacy `<title>.md` files to `index.md`, removes phantom `index-{hash}/` wrappers, and wraps bare files that have child siblings

## Dual-Mode Applicability Note

The dual-mode rule (folder when has children, bare `<slug>.md` when leaf) applies uniformly at **every level** — epic, feature, task, subtask. Any item with children is represented as a folder containing `index.md`; any item with no children is a bare `<slug>.md` file inside its parent's folder.

This means:
- A leaf epic at the project root is `<epic-slug>.md` directly under `.rex/prd_tree/`.
- A leaf feature is `<feature-slug>.md` next to the epic's `index.md`.
- A leaf task is `<task-slug>.md` next to the feature's `index.md`.
- A leaf subtask is `<subtask-slug>.md` next to the task's `index.md`, recursively for nested subtasks.

The same item flips between leaf and branch shape automatically as children are added or removed (see [Promotion Rule](#promotion-rule)).

The storage schema and uniqueness constraints apply uniformly at all levels.

---

## Versioning and Future Extensions

This is schema version `v1` of the folder-tree format with dual-mode subtask serialization. The schema is stable and backward-compatible (legacy formats are supported); future versions may introduce:

- Additional body sections (e.g., `## Metrics`, `## Risks`)
- Commit-attribution metadata fields in frontmatter
- Execution-log-derived analytics sections
- Fold-per-item `index.md` summary aggregation (designed; not yet implemented)

The serializer preserves unknown frontmatter fields for forward compatibility. Any new fields added to the schema should be added to frontmatter (not body sections) to keep them in the canonical item data.
