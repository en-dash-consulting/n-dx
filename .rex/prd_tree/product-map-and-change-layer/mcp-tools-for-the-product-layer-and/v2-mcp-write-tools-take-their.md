---
id: "07154910-ff3f-4d1d-8432-ede8d3cb03d1"
level: "task"
title: "v2 MCP write tools take their timestamp inside the PRD lock"
status: "pending"
priority: "high"
tags:
  - "pr-17"
  - "lane-rex-surface"
  - "rex"
  - "pr-review"
source: "pr-review"
acceptanceCriteria:
  - "add_item on v2 takes the split time inside the withPrdModelTransaction callback, after the tree is loaded: with another writer holding the lock that starts the change, the change's closed interval never ends before it starts and the new task's interval opens at the post-lock time (deterministic concurrency test)"
  - "place_change takes its log timestamp inside the transaction callback (test)"
  - "apply_change takes appliedAt and now inside the transaction callback, so a change applied after waiting for the lock is never stamped earlier than a write that held it (test)"
  - "No MCP tool input shape changes; the tools/list snapshot is unchanged"
run: {"contextNotes":"Rebuild before finishing: after your last edit under packages/<pkg>/src, run `pnpm --filter @n-dx/<pkg> build`, and run it again if the adversarial review repairs any file under packages/<pkg>/src. Hench runs its affected test gate right after the review without rebuilding, and the gate refuses a stale dist/ (runs d3e891fe and 699cd138 failed this way; tracked as a hench bug under d0c26ff0)."}
description: "From PR #612 review (ryrykeith, 2026-10-09, P2, packages/rex/src/cli/mcp-tools/add-item.ts:94). add_item's v2 path calls `const now = new Date()` before withPrdModelTransaction acquires the PRD lock. If another locked writer starts the change while this call waits, the mutation loads that newer active interval and addTask closes it with the older timestamp. The reviewer's deterministic probe persisted an interval starting 00:01 and ending 00:00, and opened the new task's interval at the stale time too.\n\nThe same pattern is in place-change.ts (line ~37, log timestamp) and apply-change.ts (line ~20, appliedAt and now). Fix all three: obtain now inside the locked callback, after loading the current tree, and use it for the mutation, the response and the log.\n\nLane: packages/rex/src/cli/mcp-tools/{add-item,place-change,apply-change}.ts plus tests. Use an injectable clock or a lock-holding second writer in the test, as prd-model-transaction.test.ts does."
lastModified: "2026-10-09T03:55:24.591Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
