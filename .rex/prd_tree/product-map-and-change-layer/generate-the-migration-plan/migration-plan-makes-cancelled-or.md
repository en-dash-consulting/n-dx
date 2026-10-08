---
id: "c4fb7a85-0976-4616-bb12-4f8845bd9ba2"
level: "task"
title: "Migration plan makes cancelled or deleted v1 epics and features into standing areas and capabilities"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "lane-migration"
  - "rex"
blockedBy:
  - "ab7b00bb-b362-44d9-917f-23fb0f4e85dd"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A cancelled epic with no release token is not classified as an area (test)"
  - "A deleted feature with a completed child task is not classified as a capability (test)"
description: "Verdict: should-fix (medium).\n\nScenario: packages/rex/src/core/migration-plan.ts never reads `status` when choosing a product target.\n- `classifyEpic` turns a cancelled or deleted epic with no release token into an area.\n- `classifyUnderArea` turns a noun-shaped feature into a capability when `hasCompletedWork` finds any completed descendant, even if the feature itself is cancelled or deleted.\nThe product layer would then state a requirement for something that was abandoned or removed. The plan doesn't flag it.\n\nReachability: `classifyV1Tree` on a tree with cancelled or deleted epics or features. There are 0 such cases in this repo's tree today (checked); other repositories will have them.\n\nOptions:\n(a) Recommended: never make a cancelled or deleted item a product node. Classify it as a change (unapplied for cancelled), or hold it with needsPlacement and a reason. Cost: a status check in two places plus tests.\n(b) Keep the target but add a review note to the entry and to the proposed area. Cheaper, but it leaves the wrong default.\n\nBefore finishing, run `pnpm --filter @n-dx/rex build`: the affected test gate refuses a stale rex dist/ (run 699cd138 failed only on that)."
lastModified: "2026-10-08T20:26:43.684Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
