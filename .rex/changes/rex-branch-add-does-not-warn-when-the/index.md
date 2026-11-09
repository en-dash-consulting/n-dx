---
id: "c6dc795a-a1e7-42e6-9f23-968a23876e67"
type: "change"
title: "rex branch add does not warn when the assigned task's change is blocked by an item outside the set"
slug: "rex-branch-add-does-not-warn-when-the"
intent: "Found by adversarial review of task 15984ff5. planAssignToBranch (packages/rex/src/core/work-set.ts, the warnings loop after delivery is written) checks only each unit's own blockedBy. Scenario: change C is blockedBy X (pending, not on the branch); `rex branch add <task of C>` assigns the task with no warning, yet selection never picks it (findActionableWork gates on the enclosing change's blockers) and `rex next` then reports the set as blocked by \"its change C is blocked by X\". Reachable through `rex branch add` and MCP assign_to_branch. Verdict should-fix (low): `rex next` and `rex branch show` already name the reason, so the operator learns it one step later. Fix (recommended): walk the unit's enclosing changes in the same loop and warn \"<task> is blocked through its change C by X …\" — a few lines plus a unit test in tests/unit/core/work-set.test.ts. Alternative: build the warnings from unpickableUnits' blocker reasons so the two cannot drift."
acceptanceCriteria:
  - "`rex branch add` of a task whose change is blocked by an unfinished item outside the set warns, naming that item (unit test on planAssignToBranch)"
  - "A task whose change's blockers are all done or in the set is assigned without a warning"
touches:
  - "7de075e7-b519-4f53-a17d-d0eea465530b"
priority: "low"
discoveredFrom: {"item":"15984ff5-933e-4fd7-bbb9-3ca3b6f5c446","run":"519f1d49-d554-4c3f-b5d4-6dfdbc08a253"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
