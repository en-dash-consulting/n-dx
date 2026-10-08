---
id: "27e4f378-d825-49cf-9668-1e82dba28ed4"
level: "task"
title: "Wire ndx migrate --plan to write the classified plan"
status: "pending"
priority: "high"
tags:
  - "pr-13"
  - "lane-migration"
  - "rex"
  - "core"
blockedBy:
  - "6b78242d-169b-4db5-8a6f-dee4d78da413"
source: "roadmap"
acceptanceCriteria:
  - "ndx migrate --plan writes a plan file and leaves .rex/prd_tree/ unchanged (test)"
  - "The plan lists every v1 item with its target, the proposed areas with notes, and the proposed constraints"
  - "Re-running on an unchanged tree writes an identical file"
description: "`classifyV1Tree` (packages/rex/src/core/migration-plan.ts) is pure and wired to nothing. Add the command: `ndx migrate --plan` (orchestration spawns a rex command, e.g. `rex migrate-plan`) loads the v1 tree, runs `classifyV1Tree`, and writes a reviewable plan file to an operator path outside `.rex/` (Markdown summary for review, plus the plan keyed by item id for apply). It writes nothing to the tree. Remove `core/migration-plan.ts` from the v2 isolation list in tests/unit/schema/v2.test.ts only when the v2 store is wired, not here, unless the command itself imports it from a v2 module."
lastModified: "2026-10-08T17:08:25.671Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
