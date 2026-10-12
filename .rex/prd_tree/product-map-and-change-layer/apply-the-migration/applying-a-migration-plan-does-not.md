---
id: "48598986-a990-46cc-8f40-6b93dd85a880"
level: "task"
title: "Applying a migration plan does not refuse one whose model pass is marked incomplete"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-23"
  - "lane-migration"
  - "rex"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "Applying a plan with any pass marked incomplete fails, naming the pass and its error, and writes nothing (test)"
description: "Since bb2a3276, runPlanPipeline returns normally when a seam fails, with header.passes[i].incomplete = { error } (packages/rex/src/migrations/plan-file.ts PassRecord). Entries after the failure lack the pass's merge (e.g. no capability statement) and later passes did not run. Apply (11c88bce) must refuse such a plan.\n\nUse isPlanComplete(plan) from plan-file.ts (exported by 27e4f378 for migrate --plan; add it here if it is missing): apply refuses naming the pass and its error, and writes nothing. The plan-command criterion that used to sit here moved to 27e4f378 on 2026-10-12.\n\nFirst pass (decided 2026-10-12; v2 migration path, decisions D1-D7):\n- Every v1 item lands in v2, checked by count and id. The migration drops or cancels nothing.\n- Changes the rules placed land on their capability. Changes the rules could not place (held) land in the Inbox with needsPlacement, in changes/inbox/. A text-model pick is recorded as a suggestion only.\n- Areas keep their v1 epic names, except a review-sourced epic (source \"ndx-adversarial-review\"), which proposes no area (#631 finding 1). Its children are placed or held like other changes.\n- Capability specs ship as drafted and stay flagged as unreviewed.\n- The cut is recorded as the first change, as 11c88bce describes.\n- Apply removes prd_tree/ and tree-meta.json in the same PRD transaction that writes the v2 tree, so the two layouts never exist side by side.\n- No decisions file and no area-renaming pass: those come after the cut.\n\nBoundary (stack C, roadmap PR 23):\n- Lane files: packages/rex/src/migrations/; one new rex CLI command for plan and apply, in its own module under packages/rex/src/cli/commands/ plus one dispatch line in packages/rex/src/cli/ (keep edits to the shared CLI files minimal: another stack is changing rex's store resolution and CLI error mapping in the same files, so a merge conflict is expected later); store/prd-model-writer.ts (c0dc9b3f); core/change-add.ts or the Inbox writer (2898acbe); packages/core for ndx migrate (spawn only, no library imports) and ndx init; tests.\n- Not hench, not web, not the v2 schema shape (schema/v2.ts), and not the MCP tools.\n- v1 trees keep working exactly as today, apart from the one-line deprecation notice in ad842166.\n- Each newly wired module that imports a v2 module is added to the v2 isolation allowlist in packages/rex/tests/unit/schema/v2.test.ts."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T07:16:16.313Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
