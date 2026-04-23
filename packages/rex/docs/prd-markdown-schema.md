# PRD Markdown Schema

Specification for the rex/v1 PRD markdown storage format. This document is the authoritative reference for the serializer and parser implementations.

## Purpose

This format provides a human-readable, version-control-friendly representation of the PRD tree that round-trips losslessly to and from the JSON storage format (`prd.json`). A markdown file is the canonical serialized form; JSON is the runtime representation.

## Design Principles

1. **Heading-level hierarchy** — the four item levels (epic → feature → task → subtask) map directly to heading levels (H2 → H3 → H4 → H5). No other encoding is needed to recover the hierarchy.
2. **`rex-meta` fenced block** — every item carries a YAML fenced block with the info string `rex-meta` immediately after its heading. All structured fields live in this block; no metadata is embedded in heading text.
3. **Prose description** — markdown prose following the `rex-meta` block (and before the next heading of equal or lower level) is the item's `description` field.
4. **Omit absent fields** — a field that is `undefined` or `null` in JSON is omitted from the YAML block. On parse, missing fields deserialize to `undefined`. Empty arrays may be explicitly written as `field: []` or omitted; both round-trip to the same empty-array value.
5. **No information collision** — every JSON field has exactly one markdown encoding. There is no field whose value can appear in more than one place.

---

## Document Structure

```
<YAML front-matter>
# <document title>

<item sections...>
```

### YAML Front-Matter

The front-matter block at the top of the file encodes `PRDDocument`-level fields:

```yaml
---
schema: rex/v1
---
```

| Front-matter key | JSON field | Type | Notes |
|-----------------|-----------|------|-------|
| `schema` | `PRDDocument.schema` | string | Always `rex/v1` for current documents |

Additional top-level fields in `PRDDocument` (via `[key: string]: unknown`) are encoded as extra front-matter keys. Parsers must preserve unknown front-matter keys on round-trip.

### Document Title

An H1 heading immediately after the front-matter carries `PRDDocument.title`:

```markdown
# My Project
```

---

## Item Encoding

Each PRD item is a heading followed by a `rex-meta` fenced block and optional prose:

```markdown
## Epic Title

​```rex-meta
id: "550e8400-e29b-41d4-a716-446655440000"
status: pending
priority: high
tags:
  - backend
  - auth
​```

Prose description follows here. This is the `description` field.
It can span multiple paragraphs.

### Feature Title
...
```

### Heading Level → Item Level

| Heading | Item level |
|---------|-----------|
| H2 (`##`) | `epic` |
| H3 (`###`) | `feature` |
| H4 (`####`) | `task` |
| H5 (`#####`) | `subtask` |

The `level` field is **implicit** from the heading depth. It is also included in the `rex-meta` block for validation but is not the authoritative source — heading depth is. On round-trip, the serializer writes both; the parser reads heading depth as authoritative and cross-checks with the `level` key.

### `rex-meta` Block

The info string `rex-meta` marks the block as item metadata. The block body is YAML. No other fenced block with the info string `rex-meta` may appear inside an item's description prose (use a different info string for code examples that happen to look like YAML).

#### Core Fields

| YAML key | JSON field | Type | Notes |
|----------|-----------|------|-------|
| `id` | `id` | string (UUID) | Required. Always quoted. |
| `level` | `level` | enum | `epic` \| `feature` \| `task` \| `subtask` |
| `status` | `status` | enum | `pending` \| `in_progress` \| `completed` \| `failing` \| `deferred` \| `blocked` \| `deleted` |
| `priority` | `priority` | enum? | `critical` \| `high` \| `medium` \| `low`. Omit if absent. |
| `tags` | `tags` | string[]? | YAML sequence. Omit if absent or empty. |
| `source` | `source` | string? | Origin identifier (e.g., `smart-add`). Omit if absent. |
| `blockedBy` | `blockedBy` | string[]? | YAML sequence of UUIDs. Omit if absent or empty. |

#### Timestamps

All timestamps are ISO 8601 strings. Always quoted.

| YAML key | JSON field | Notes |
|----------|-----------|-------|
| `startedAt` | `startedAt` | First transition into `in_progress`. |
| `completedAt` | `completedAt` | Latest transition into `completed`. |
| `endedAt` | `endedAt` | Most recent transition out of `in_progress`. |

#### Work Intervals

`activeIntervals` encodes the append-only work log:

```yaml
activeIntervals:
  - start: "2026-01-10T09:00:00.000Z"
    end: "2026-01-10T17:00:00.000Z"
  - start: "2026-01-11T09:00:00.000Z"
```

An interval with no `end` key is open (item currently in progress). On parse, an absent `end` key deserializes to `undefined` (not an empty string).

#### Acceptance Criteria

```yaml
acceptanceCriteria:
  - "First criterion text."
  - "Second criterion text."
```

Each element is a plain string. Always quoted when the string contains special YAML characters (`:`, `#`, `[`, `]`, `{`, `}`). Omit the key when the array is empty or absent.

#### Level-of-Effort Fields

LoE fields originate in proposal objects but may be persisted to items via passthrough:

| YAML key | JSON field | Type | Notes |
|----------|-----------|------|-------|
| `loe` | `loe` | number? | Engineer-weeks estimate. |
| `loeRationale` | `loeRationale` | string? | One-sentence justification. |
| `loeConfidence` | `loeConfidence` | enum? | `low` \| `medium` \| `high`. |

#### Token Usage

`tokenUsage` encodes a `TokenUsage` object:

```yaml
tokenUsage:
  input: 12345
  output: 678
  cacheCreationInput: 1000
  cacheReadInput: 500
```

All sub-fields are numbers. `cacheCreationInput` and `cacheReadInput` are optional; omit if absent.

#### Duration

`duration` encodes computed or cached duration data. It is not stored directly on `PRDItem` in the runtime model (derived from `activeIntervals`), but may be written to markdown for human readability. On import, `duration` values are **advisory** — the parser ignores them if `activeIntervals` is present (derive from intervals instead). Write them only when `activeIntervals` is absent:

```yaml
duration:
  totalMs: 28800000
  runningMs: 0
```

#### Completion and Failure Fields

| YAML key | JSON field | Type | Notes |
|----------|-----------|------|-------|
| `resolutionType` | `resolutionType` | enum? | `code-change` \| `config-override` \| `acknowledgment` \| `deferred` \| `unclassified` |
| `resolutionDetail` | `resolutionDetail` | string? | Brief description. |
| `failureReason` | `failureReason` | string? | Present when status is `failing`. |

#### Structured Requirements

`requirements` encodes a sequence of `Requirement` objects. Each requirement is an inline YAML object within the sequence:

```yaml
requirements:
  - id: "req-uuid-here"
    title: "Response time under 200ms"
    description: "95th-percentile API response time must be ≤ 200ms under normal load."
    category: performance
    validationType: metric
    threshold: 200
    validationCommand: "pnpm perf:measure"
    priority: high
    acceptanceCriteria:
      - "p95 latency ≤ 200ms in load test"
      - "p99 latency ≤ 500ms in load test"
```

Requirement fields:

| YAML key | Type | Required |
|----------|------|---------|
| `id` | string (UUID) | Yes |
| `title` | string | Yes |
| `description` | string | No |
| `category` | enum (`technical` \| `performance` \| `security` \| `accessibility` \| `compatibility` \| `quality`) | Yes |
| `validationType` | enum (`automated` \| `manual` \| `metric`) | Yes |
| `acceptanceCriteria` | string[] | Yes (may be `[]`) |
| `validationCommand` | string | No |
| `threshold` | number | No |
| `priority` | Priority enum | No |

#### Provenance Fields

These fields are written when present and preserved verbatim on round-trip. They are informational and should not be mutated by parsers.

**`overrideMarker`** (object, written inline):

```yaml
overrideMarker:
  type: duplicate_guard_override
  reason: exact_title
  reasonRef: "exact_title:abc123"
  matchedItemId: "abc123"
  matchedItemTitle: "Existing item title"
  matchedItemLevel: task
  matchedItemStatus: completed
  createdAt: "2026-01-10T09:00:00.000Z"
```

**`mergedProposals`** (sequence):

```yaml
mergedProposals:
  - proposalNodeKey: "p0:task:0:1"
    proposalTitle: "Original proposal title"
    proposalKind: task
    reason: semantic_title
    score: 0.85
    mergedAt: "2026-01-10T09:00:00.000Z"
    source: smart-add
```

#### Passthrough Fields

Unknown fields in `PRDItem` (via `[key: string]: unknown`) are preserved in the `rex-meta` block under a `_passthrough` mapping:

```yaml
_passthrough:
  customField: "any value"
  anotherField: 42
```

This prevents unknown fields from polluting the top-level namespace while ensuring round-trip fidelity. On serialize, collect all keys not in the known field set into `_passthrough`. On parse, unpack `_passthrough` back into the top-level item object.

---

## Description Field

The `description` field is the markdown prose between the `rex-meta` block and the next heading at the same or shallower level. Rules:

1. Leading and trailing whitespace (blank lines) are stripped.
2. The description may contain any valid markdown: paragraphs, lists, code blocks, tables.
3. **Exception**: fenced blocks with the info string `rex-meta` must not appear inside descriptions (reserved for item metadata). Use `yaml` or another info string for YAML examples.
4. A missing description section (no prose between `rex-meta` and the next heading) deserializes to `undefined`.

---

## Hierarchy Encoding

Children of an item are headings of the next deeper level that appear before the next sibling or ancestor heading:

```markdown
## Epic A                    ← epic

​```rex-meta
id: "..."
level: epic
status: pending
​```

### Feature A.1              ← child of Epic A

​```rex-meta
id: "..."
level: feature
status: in_progress
​```

#### Task A.1.1              ← child of Feature A.1

​```rex-meta
id: "..."
level: task
status: completed
​```

### Feature A.2              ← sibling of Feature A.1, child of Epic A

## Epic B                    ← sibling of Epic A (not a child)
```

The parser builds the tree by tracking the current heading depth stack. An item's children are all consecutive deeper headings before the next heading at the item's own level or shallower.

---

## Complete Example

```markdown
---
schema: rex/v1
---

# My Project

## Authentication

​```rex-meta
id: "epic-uuid-0001"
level: epic
status: in_progress
priority: critical
tags:
  - security
  - auth
source: smart-add
startedAt: "2026-01-01T10:00:00.000Z"
​```

Covers all user authentication and session management features.

### Login Flow

​```rex-meta
id: "feature-uuid-0001"
level: feature
status: in_progress
priority: high
startedAt: "2026-01-02T09:00:00.000Z"
​```

Email/password login with rate limiting and brute-force protection.

#### Implement login endpoint

​```rex-meta
id: "task-uuid-0001"
level: task
status: completed
priority: high
tags:
  - backend
acceptanceCriteria:
  - "POST /auth/login returns 200 with JWT on valid credentials"
  - "POST /auth/login returns 401 on invalid credentials"
  - "Rate limiting enforced: max 5 attempts per IP per minute"
loe: 0.5
loeRationale: "Straightforward CRUD with existing auth library."
loeConfidence: high
startedAt: "2026-01-02T09:00:00.000Z"
completedAt: "2026-01-03T16:30:00.000Z"
endedAt: "2026-01-03T16:30:00.000Z"
activeIntervals:
  - start: "2026-01-02T09:00:00.000Z"
    end: "2026-01-03T16:30:00.000Z"
resolutionType: code-change
resolutionDetail: "Implemented POST /auth/login with bcrypt comparison and JWT signing."
requirements:
  - id: "req-uuid-0001"
    title: "Login rate limiting"
    category: security
    validationType: automated
    validationCommand: "pnpm test -- auth/rate-limit"
    acceptanceCriteria:
      - "Max 5 attempts per IP per minute"
​```

Implements `POST /auth/login`. Accepts `{ email, password }` and returns `{ token }` on success.

##### Add integration test for rate limiting

​```rex-meta
id: "subtask-uuid-0001"
level: subtask
status: completed
priority: medium
startedAt: "2026-01-03T14:00:00.000Z"
completedAt: "2026-01-03T15:45:00.000Z"
activeIntervals:
  - start: "2026-01-03T14:00:00.000Z"
    end: "2026-01-03T15:45:00.000Z"
resolutionType: code-change
​```

## Dashboard

​```rex-meta
id: "epic-uuid-0002"
level: epic
status: pending
priority: medium
​```
```

---

## Edge Cases

### Null / Undefined Fields

Omit from the `rex-meta` block entirely. On parse, the field is `undefined`. Do not write `field: null` or `field: ~`.

### Empty Arrays

Omit from the `rex-meta` block. Both absent and `field: []` parse to an empty array. The canonical serialized form omits empty arrays.

**Exception**: `acceptanceCriteria` on a `Requirement` must always be written, even when empty (`acceptanceCriteria: []`), because it is a required field with a default value.

### Special Characters in Titles

Markdown heading text is not escaped by the schema — standard markdown rendering applies. Heading text must not be modified by the serializer. If a title contains characters that affect markdown rendering (e.g., a literal backtick), wrap the heading text in backtick spans or use the markdown escaping rules. The parser extracts title text by stripping the leading `#` characters and surrounding whitespace.

**Prohibited**: the parser must never use the title to identify an item. `id` is the canonical identifier.

### Multi-Line Descriptions

The description may span arbitrarily many paragraphs and lines. The serializer writes the full description as-is. The parser captures everything from the first non-blank line after the `rex-meta` block's closing fence to the last non-blank line before the next heading.

### Items with No Description

When `description` is `undefined`, the `rex-meta` block is followed immediately by the next heading (or end of file). The serializer does not write a blank line placeholder; a single blank line between the fence and the next heading is sufficient for readability.

### Deeply Nested Descriptions Containing Headings

A description may not contain headings — headings are always interpreted as new item boundaries. If a description must reference a heading for documentation purposes, use a bold label (`**Section**`) or a blockquote instead.

### Re-Opened Tasks

When a task is re-opened, a new open interval is appended to `activeIntervals`. The `completedAt` field is cleared (omitted). `startedAt` retains the original value (first start). `endedAt` is cleared (omitted) until the task reaches a terminal state again.

### Deleted Items

Items with `status: deleted` are included in the markdown file with their full metadata. The serializer does not omit deleted items; the consumer decides whether to filter them.

### Unicode in Titles and Strings

All string values are UTF-8. No escaping is applied by the schema beyond standard YAML and markdown rules.

---

## Parser Contract

1. **Front-matter parse**: extract YAML between the opening `---` and closing `---`.
2. **H1 extract**: the first H1 heading after the front-matter is `PRDDocument.title`.
3. **Item scan**: scan headings H2–H5 in document order. Each heading opens an item scope.
4. **`rex-meta` block**: the first fenced block with info string `rex-meta` immediately following the heading (no other content between them except blank lines) is the item's metadata block. Parse its body as YAML.
5. **Level validation**: cross-check `level` field in `rex-meta` against heading depth. Warn on mismatch; trust heading depth.
6. **Description capture**: all content between the `rex-meta` block's closing fence and the next heading is the item's `description`. Strip leading and trailing blank lines.
7. **Child scope**: headings deeper than the current heading are the item's children. Build the tree recursively.
8. **Passthrough**: unpack `_passthrough` into the item's top-level object after construction.
9. **Duration advisory**: if `activeIntervals` is present, ignore `duration` values in the block (recompute from intervals). If `activeIntervals` is absent, accept `duration` as a cached hint.

## Serializer Contract

1. Write YAML front-matter with `schema`.
2. Write H1 with `PRDDocument.title`.
3. For each item in DFS order (pre-order):
   a. Write heading at the appropriate level.
   b. Write `rex-meta` block with all non-undefined, non-null fields.
   c. Collect unknown passthrough fields into `_passthrough` if any.
   d. Write `description` as prose if non-empty.
4. Field ordering in `rex-meta`: write `id`, `level`, `status`, `priority` first (identity and state fields), then alphabetical order for remaining fields. This produces stable diffs.
5. Omit empty arrays and `undefined` values.
6. Always quote UUID strings and ISO timestamps in YAML.
