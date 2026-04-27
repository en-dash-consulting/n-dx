# PRD Folder Tree Schema

Normative contract for the serializer (PRD → folders) and parser (folders → PRD) implementations. See also: sibling tasks `Implement PRD-to-folder-tree serializer` and `Implement folder-tree-to-PRD parser`.

---

## Directory Layout

Tree root: `.rex/tree/` (configurable). Within it, the PRD hierarchy maps to nested directories:

```
.rex/tree/
├── {epic-slug}/
│   ├── index.md
│   └── {feature-slug}/
│       ├── index.md
│       └── {task-slug}/
│           └── index.md        ← subtasks as sections, not directories
└── …
```

**Rules:**
- Each epic, feature, or task maps to exactly one directory containing exactly one `index.md`.
- Subtasks appear as `## Subtask:` sections inside the parent task's `index.md` — never as nested directories.
- Nesting depth encodes level: epics at depth 1, features at depth 2, tasks at depth 3.

---

## Naming Convention

### Slug Algorithm

Every directory name is derived deterministically from the item's **title** and **ID**.

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
| 9 | Truncate to ≤ 40 characters: if the 40th character falls mid-segment, search backward for the last hyphen and truncate there, then strip the trailing hyphen |
| 10 | Append `-{id8}` where `id8 = id.replace(/-/g, "").slice(0, 8)` |

If steps 1–8 produce an empty string (all characters stripped), the slug is the bare `{id8}` with no leading hyphen.

### Examples

| Title | ID prefix | Slug |
|-------|-----------|------|
| `Web Dashboard` | `4d62fa6c` | `web-dashboard-4d62fa6c` |
| `Hot-reload MCP tool schemas on HTTP transport without server restart` | `5dd63e4e` | `hot-reload-mcp-tool-schemas-on-http-5dd63e4e` |
| `Héros & Légendes` | `a1b2c3d4` | `heros-legendes-a1b2c3d4` |
| `日本語タイトル` | `f0e1d2c3` | `f0e1d2c3` |
| `--- !!!` | `11223344` | `11223344` |

**Long-title trace** (`Hot-reload MCP…`):
- After steps 1–8: `hot-reload-mcp-tool-schemas-on-http-transport-without-server-restart`
- First 40 chars: `hot-reload-mcp-tool-schemas-on-http-tran` — truncation point falls inside `transport`
- Last hyphen before position 40: position 36 (`…-http-`)
- Body after truncation: `hot-reload-mcp-tool-schemas-on-http`
- Final slug: `hot-reload-mcp-tool-schemas-on-http-5dd63e4e`

### Collision Resistance

The `{id8}` suffix is derived from 32 hex characters of a UUID v4. The probability of two siblings sharing the same 8-character prefix is < 1 in 4 billion. No sequential counter or retry loop is needed.

---

## index.md Schema

Every `index.md` begins with a YAML frontmatter block, followed by Markdown body content. **Bold** = required.

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

## Full index.md Examples

### Epic

```markdown
---
id: "4d62fa6c-ad0d-4e1e-91f8-c2f1ebe696e7"
level: epic
title: "Web Dashboard"
status: completed
startedAt: "2026-03-24T05:27:03.754Z"
completedAt: "2026-03-24T20:36:04.012Z"
description: >-
  Unified web dashboard and MCP HTTP server. Preact-based UI with SourceVision,
  Rex, and Hench views.
---

## Children

| Title | Status |
|-------|--------|
| [Hot-reload MCP tool schemas on HTTP transport without server restart](./hot-reload-mcp-tool-schemas-on-http-5dd63e4e/index.md) | completed |
| [Dashboard Route Ownership Decoupling](./dashboard-route-ownership-decoupling-f89b6b48/index.md) | completed |
```

### Feature

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
  must restart the server to pick up changes.
---

## Children

| Title | Status |
|-------|--------|
| [Implement file-watch reload trigger](./implement-file-watch-reload-trigger-a1b2c3d4/index.md) | completed |
```

### Task

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
acceptanceCriteria:
  - "Token Usage is reachable from global nav without being scoped to Rex"
  - "Routing and UI metadata are consistent with other global dashboard sections"
loe: s
description: >-
  Make Token Usage a first-class global dashboard destination instead of a
  Rex-scoped view so routing and UI metadata remain consistent across sections.
---

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

---

## Recursive Children Summary Block

Every `index.md` whose item has direct children **must** include a `## Children` section at the end of the Markdown body. Tasks **never** include this section — their children are subtasks encoded as sections.

### Format

```markdown
## Children

| Title | Status |
|-------|--------|
| [{child title}](./{child-slug}/index.md) | {status} |
```

**Rules:**
- Children listed in PRD insertion order.
- Relative link: `./` + child directory name + `/index.md`.
- If a non-leaf item has no children (empty container), omit the `## Children` section entirely.
- The parser **ignores** this section for tree reconstruction — it uses directory nesting as ground truth. The section is informational only.

---

## Subtask Encoding

Subtasks are encoded as `## Subtask: {title}` sections within the parent task's `index.md`.

### Format

```markdown
## Subtask: {title}

**ID:** `{uuid}`
**Status:** {status}
**Priority:** {priority}            ← omit line if priority is not set

{description prose}                 ← omit if description is empty

**Acceptance Criteria**             ← omit entire block if list is empty

- criterion one
- criterion two

---
```

**Rules:**
- Each subtask section is delimited from the next by a horizontal rule (`---`).
- The final subtask section requires no trailing `---`.
- Fields appear in the fixed order shown above. No YAML frontmatter.
- Fields with no value are omitted entirely (do not write `**Priority:** ` with an empty value).

---

## Serializer Contract

The serializer (PRD → folder tree) must:

1. Compute each item's slug using the algorithm in [Naming Convention](#naming-convention).
2. Create directories at the correct nesting depth under the tree root.
3. Write `index.md` with all required frontmatter fields and the correct body.
4. For task items, append `## Subtask:` sections for each subtask child.
5. For non-leaf items with at least one child, append a `## Children` section listing direct children in insertion order.
6. Write atomically: build the entire tree into a temp directory, then rename it into place to prevent partial states.
7. Preserve unknown frontmatter fields (round-trip fidelity for future extensions).

---

## Parser Contract

The parser (folder tree → PRD) must:

1. Discover all `index.md` files under the tree root using depth-first traversal.
2. Parse the YAML frontmatter from each file to extract structured fields.
3. Infer parent-child relationships from directory nesting depth — a file at `tree/{a}/{b}/{c}/index.md` is a task `{c}` whose parent is feature `{b}` whose parent is epic `{a}`.
4. For task-level files, parse `## Subtask:` sections to reconstruct subtask items.
5. Ignore the `## Children` summary table (informational only; directory structure is authoritative).
6. Reject files with missing required frontmatter fields with a descriptive error identifying the file path and the missing field.
7. Reconstruct items in directory-entry order (alphabetical by slug) within each level, which preserves insertion order because slugs are stable.

---

## Field Summary Table

| Field | Epic | Feature | Task | Subtask (section) |
|-------|------|---------|------|-------------------|
| `id` | required | required | required | required |
| `level` | required | required | required | — (implicit: subtask) |
| `title` | required | required | required | required (heading) |
| `status` | required | required | required | required |
| `description` | required | required | required | optional |
| `acceptanceCriteria` | — | required | required | optional |
| `loe` | — | optional | optional | — |
| `priority` | optional | optional | optional | optional |
| `tags` | optional | optional | optional | — |
| `source` | optional | optional | optional | — |
| `startedAt` | optional | optional | optional | — |
| `completedAt` | optional | optional | optional | — |
| `endedAt` | optional | optional | optional | — |
| `resolutionType` | optional | optional | optional | — |
| `resolutionDetail` | optional | optional | optional | — |
| `failureReason` | optional | optional | optional | — |
| `## Children` body block | when children exist | when children exist | — | — |
| `## Subtask:` body sections | — | — | when subtasks exist | — |
