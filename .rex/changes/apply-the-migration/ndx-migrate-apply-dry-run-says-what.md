---
id: "1c70426e-d76a-4a1e-89e8-4f2ca7d14c7a"
type: "task"
title: "ndx migrate --apply --dry-run says what moves and what is dropped"
slug: "ndx-migrate-apply-dry-run-says-what"
description: "rex migrate --apply --dry-run (and ndx migrate --apply --dry-run, which spawns it) runs apply up to the write and prints what would happen instead: for each v1 kind (epic, feature, task, subtask), how many items become each v2 type (area, capability, constraint, change, task, dissolved release), how many changes are held for the Inbox, and how many metadata values are dropped (droppedMeta, droppedLog). The counts per kind add up to the v1 total, which is the rehearsal gate's first check. It writes nothing: no v2 tree, no removal of prd_tree/ or tree-meta.json, no plan rewrite. It applies the same refusals as a real apply (incomplete plan, stale plan) so a clean dry run means apply would proceed.\n\nAlso wire the orchestration side, which 11c88bce left out: `ndx migrate --apply [--plan <path>] [--dry-run] [dir]` in packages/core spawns `rex migrate --apply` with the same flags (space-separated values rewritten to the = form, as `--out` already is for --plan) and forwards rex's exit code. Spawn only; no library imports. (Added overnight 2026-10-12; confirm.)\n\nFirst pass (decided 2026-10-12; v2 migration path, decisions D1-D7):\n- Every v1 item lands in v2, checked by count and id. The migration drops or cancels nothing.\n- Changes the rules placed land on their capability. Changes the rules could not place (held) land in the Inbox with needsPlacement, in changes/inbox/. A text-model pick is recorded as a suggestion only.\n- Areas keep their v1 epic names, except a review-sourced epic (source \"ndx-adversarial-review\"), which proposes no area (#631 finding 1). Its children are placed or held like other changes.\n- Capability specs ship as drafted and stay flagged as unreviewed.\n- The cut is recorded as the first change, as 11c88bce describes.\n- Apply removes prd_tree/ and tree-meta.json in the same PRD transaction that writes the v2 tree, so the two layouts never exist side by side.\n- No decisions file and no area-renaming pass: those come after the cut.\n\nBoundary (stack C, roadmap PR 23):\n- Lane files: packages/rex/src/migrations/; one new rex CLI command for plan and apply, in its own module under packages/rex/src/cli/commands/ plus one dispatch line in packages/rex/src/cli/ (keep edits to the shared CLI files minimal: another stack is changing rex's store resolution and CLI error mapping in the same files, so a merge conflict is expected later); store/prd-model-writer.ts (c0dc9b3f); core/change-add.ts or the Inbox writer (2898acbe); packages/core for ndx migrate (spawn only, no library imports) and ndx init; tests.\n- Not hench, not web, not the v2 schema shape (schema/v2.ts), and not the MCP tools.\n- v1 trees keep working exactly as today, apart from the one-line deprecation notice in ad842166.\n- Each newly wired module that imports a v2 module is added to the v2 isolation allowlist in packages/rex/tests/unit/schema/v2.test.ts."
acceptanceCriteria:
  - "It writes nothing (test)"
  - "It prints per kind how many v1 items become each v2 type, how many are held for the Inbox, and how many metadata values are dropped (droppedMeta, droppedLog) (test)"
  - "ndx migrate --apply [--plan <path>] [--dry-run] spawns rex migrate --apply with those flags and forwards its exit code (test)"
priority: "high"
tags:
  - "pr-23"
  - "lane-migration"
  - "rex"
  - "core"
source: "roadmap"
blockedBy:
  - "11c88bce-4e63-4e56-b0b8-041232f0a21a"
---
