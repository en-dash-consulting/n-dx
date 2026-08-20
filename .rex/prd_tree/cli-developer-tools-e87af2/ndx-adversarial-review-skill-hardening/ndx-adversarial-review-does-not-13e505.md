---
id: "13e50500-d6d2-48ba-8f56-56c53f553419"
level: "task"
title: "/ndx-adversarial-review does not map findings onto add_item's level, priority, and acceptanceCriteria fields"
status: "pending"
priority: "medium"
tags:
  - "skills"
  - "severity:medium"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "The capture step names `add_item`'s real parameters: `title`, `level`, `parentId`, `description`, `priority`, `acceptanceCriteria`, `tags`, `source`"
  - "The severity-to-`priority` mapping is stated explicitly, noting the enums are identical"
  - "Acceptance criteria are directed to the `acceptanceCriteria` array rather than to description prose"
  - "A default `level` is specified so repeated runs do not produce inconsistent levels"
description: "**Severity:** medium — **Verdict:** should-fix\n\n**Failure scenario.** The capture step describes item content in prose (\"Acceptance criteria — written so they fail today\", \"Severity and verdict — carried into the item\") without naming `add_item`'s actual parameters. Consequences on every run:\n\n- `level` is a **required** parameter (`packages/rex/src/cli/mcp.ts:119`, `z.enum(...)` with no `.optional()`) and the skill never says what to use, so each run guesses. Levels drift between runs.\n- `priority` accepts exactly `critical | high | medium | low` (`mcp.ts:122`) — **identical to the skill's own severity scale** — but the mapping is never stated, so severity may land in description prose instead.\n- `acceptanceCriteria` is a first-class array (`mcp.ts:123`). Criteria written into `description` instead are invisible to `verify_criteria` and to the web dashboard's requirements view, which quietly defeats claim mode on the next review of the same item.\n- `source` exists and is ideal for provenance, but the skill never mentions it.\n\n**Evidence.** `packages/core/assistant-assets/skills/ndx-adversarial-review.md` — the capture step's bullet list, versus the `add_item` schema at `packages/rex/src/cli/mcp.ts:115-129`.\n\n**Reachability.** Every capture the skill performs.\n\n**Possible solutions.**\n1. *Recommended.* Replace the bullet list with an explicit field mapping: `level` → `task` unless the finding is larger, severity → `priority`, criteria → `acceptanceCriteria`, failure scenario + evidence + solutions → `description`, `source` → `ndx-adversarial-review`, `tags` → review name plus severity, `parentId` → the owning feature or epic. Costs a rewrite of one section and removes all guessing.\n2. Minimal: name only `level` and `acceptanceCriteria`, leaving the rest to judgment. Cheaper, but leaves the severity/`priority` duplication unresolved and provenance unset."
---
