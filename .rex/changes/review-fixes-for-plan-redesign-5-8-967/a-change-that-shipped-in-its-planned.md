---
id: "56f06d41-001e-4f56-b83f-a88cdb918602"
type: "task"
title: "A change that shipped in its planned release is not stale"
slug: "a-change-that-shipped-in-its-planned"
description: "Stack review finding on #967 at packages/rex/src/schema/v2-rules.ts:939 (review comment 4488638059).\n\n**Should fix: stale-release flags a change that shipped in the release it was planned for**\n\nThe rule skips a change only when `!isOpenChange(node)`, and a change with no `appliedAt` counts as open. Under `rex.applyOn: review`, `planReleaseStamp` stamps `shippedIn` on completed changes that are not applied yet (`release-stamp.ts:84`), and `stageOf` treats that state as shipped. Take a change with `status: completed, plannedRelease: \"0.10.0\", shippedIn: \"0.10.0\"` and no `appliedAt`. It adds 0.10.0 to `shipped` and then matches it, so `rex validate`, MCP `health` and the Plan health light all tell the operator to re-plan a change that shipped as planned.\n\nFix: `if (!planned || node.shippedIn || !isOpenChange(node)) return [];`. Add a case with `shippedIn` to the `stale-release-plan` describe block."
acceptanceCriteria:
  - "The stale-release rule in packages/rex/src/schema/v2-rules.ts skips a change with shippedIn (if (!planned || node.shippedIn || !isOpenChange(node)) return [])"
  - "The stale-release-plan tests have a case with shippedIn that is not flagged"
---
