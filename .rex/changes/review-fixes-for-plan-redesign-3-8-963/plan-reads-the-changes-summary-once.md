---
id: "94a2fc84-71b6-4dfe-a6ea-10f2f703a63b"
type: "task"
title: "Plan reads the changes summary once"
slug: "plan-reads-the-changes-summary-once"
description: "Stack review finding on #963 at packages/web/src/viewer/views/changes-glance.ts:64 (review comment 4488637220).\n\n**Should fix: Plan fetches the summary twice on load and on every PRD change**\n\n`LifecycleStrip` (lifecycle-strip.ts:115) and `ChangesGlance` each call `useProductRead(\"/api/rex/changes/summary\", …)`. The hook neither dedupes nor caches, and each instance subscribes to `rex:prd-changed`. So every Plan load and every PRD write runs the full model load twice. During `ndx work`, which writes the PRD repeatedly, that doubles this page's server load, which defeats the purpose of the summary route. Read the summary once, through a shared hook or context in the stage grid, and pass the result to both panels."
acceptanceCriteria:
  - "One shared read (a context or shared hook in the stage grid) feeds both the lifecycle strip and the open-changes glance"
  - "Each Plan load and each PRD change makes one /api/rex/changes/summary request, and a test asserts the count"
---
