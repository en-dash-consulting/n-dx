---
id: "84d82d83-e4ff-44d6-b44f-ec27846e12dd"
type: "change"
title: "A task-less change on a branch's work set loses its assignment when it is split into tasks"
slug: "a-task-less-change-on-a-branch-s-work"
intent: "Found by adversarial review of task 7567a708 (work-set delivery field). Verdict: should-fix, severity medium.\n\nScenario: `assignToBranch(rexDir, [C], \"feat/x\")` on a task-less change C writes `delivery: { branch: \"feat/x\" }` on C's own row (packages/rex/src/core/work-set.ts, planAssignToBranch). Later C gains tasks (hench splits it with add_item, or a person adds a task). C's shape is now `tasks`, so `readWorkSet(tree, \"feat/x\")` skips C (isUnit false) and its new tasks carry no `delivery`: the result is `{ ids: [], hasAssignments: true }`. The branch reads as having a work set with nothing in it, so the sibling task that makes `ndx work` / `get_next_task` pick only from the work set will pick nothing on that branch, and assigning one of C's new tasks to another branch is not refused.\n\nReachable once the work-set selection task lands; splitting a task-less change is a routine hench path. change-selection already handles the same shape for claims (\"a claim on a task-less change covers the task it later splits into\").\n\nOptions:\n1. readWorkSet (and the assign refusal) treat a change's own `delivery` as covering its open tasks that carry none (inheritance). Cheap, no write at split time; the refusal check must consult the enclosing change too. Recommended.\n2. Push the change's `delivery` down onto the new tasks when a task is added under a change that has one (add_item / change-add), and drop it from the change. Keeps the \"unit carries the field\" rule literal but adds a write rule to every task-adding path.\nDecision for the owner: inheritance vs push-down."
acceptanceCriteria:
  - "After a task-less change assigned to branch B gains an open task, readWorkSet(tree, B) lists that task's id"
  - "Assigning that new task to a different branch without move is refused, naming B"
  - "A core test covers the assign-then-split sequence"
touches:
  - "7de075e7-b519-4f53-a17d-d0eea465530b"
priority: "medium"
discoveredFrom: {"item":"7567a708-d942-448f-9869-3cbc2aed9bab","run":"365a9413-ae5b-426e-8d20-ec3941c4b395"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
