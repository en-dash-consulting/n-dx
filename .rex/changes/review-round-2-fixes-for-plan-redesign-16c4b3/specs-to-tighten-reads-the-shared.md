---
id: "2fb8468b-d432-4948-9372-a0093fafdf40"
type: "task"
title: "Specs to tighten reads the shared summary"
slug: "specs-to-tighten-reads-the-shared"
description: "Stack review round 2 finding on #967 at packages/web/src/viewer/views/spec-gaps.ts:55 (review comment 4494324560).\n\n**Should fix: Specs to tighten bypasses `ChangesSummaryProvider`**\n\nThis calls `useProductRead(\"/api/rex/changes/summary\", …)` directly, although it renders inside the Plan stage's `ChangesSummaryProvider`. That brings back a second full model load on every Plan load and every `rex:prd-changed`, which is what #963's fix removed. Use `const load = useChangesSummary();`. The rest of the panel already reads the same `Load<ChangeSummary>` shape. Mount the test under a provider. The same code is still at S8."
acceptanceCriteria:
  - "spec-gaps.ts reads the changes summary through useChangesSummary() instead of its own useProductRead"
  - "Its test mounts the tile under ChangesSummaryProvider and asserts one summary read"
---
