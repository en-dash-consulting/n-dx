---
id: "b4413a5d-5b91-44ab-8044-131520f4887e"
level: "task"
title: "Hold the agent's completion write until hench's test gate passes"
status: "pending"
priority: "high"
tags:
  - "0.7.1"
  - "pr-c2"
  - "hench"
  - "test-gate"
  - "commit-hygiene"
source: "PR M execution, 2026-09-24 (runs 6eacca42, 8dc53406); deferred C follow-up (run a6e7efa6)"
acceptanceCriteria:
  - "In a hench run where the agent marks its task completed and the test gate then fails, the task is not completed on disk or in any commit, and its resolution detail is preserved for the retry."
  - "When the gate passes, the task becomes completed in hench's record commit, with the agent's resolution type and detail."
  - "Review repairs from a run whose gate fails are either committed as their own commit or clearly reported as left uncommitted; they are never silently mixed into a later commit."
  - "Marking a task completed outside a hench run (interactive MCP use, rex CLI) behaves as today."
  - "An integration test reproduces the 6eacca42 sequence (agent completes and commits, gate fails) and asserts the task is not completed."
description: "A failed test gate leaves a task committed as completed. The agent marks its own task completed through rex MCP, then runs `git add -A && git commit`, which folds the PRD status flip into the work commit. hench's mandatory full-suite gate runs only after that, and when it fails, nothing withdraws the completion. Runs 6eacca42 (b75b2958), 8dc53406 (c4166591) and a6e7efa6 all ended `failed` with the task `completed` on disk and in git. In 8dc53406 the review repairs were also left uncommitted, because hench commits those only after the gate passes.\n\nDecision 2026-09-24, option (c): no completion lands before the gate passes. Rejected: (a) resetting the task and committing that as a record, and (b) leaving it completed and flagging it failing. Both let the PRD state `completed` for a while for work that has not passed.\n\nA likely mechanism: during a hench run the task is claimed by that run (rex `store/claims.ts`), so rex MCP `update_task_status completed` on a task held by a live hench run can record the resolution as pending, not apply it. hench then applies it after the gate passes, in its own record commit. Also check whether the agent's `git add -A` should exclude `.rex/prd_tree/` during a hench run. This includes the C follow-up deferred from #402 (\"a failed test gate that left a task committed as completed\")."
lastModified: "2026-09-24T20:30:23.756Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
