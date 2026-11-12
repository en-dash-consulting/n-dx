---
id: "84d82d83-e4ff-44d6-b44f-ec27846e12dd"
type: "change"
title: "Work sets follow-ups: a change's branch covers its tasks, and the hench gateway goes back to 69"
slug: "a-task-less-change-on-a-branch-s-work"
intent: "Follow-ups to change d20fbfb8 (branch work sets, P2-1, PR #1010), decided by Ryan 2026-11-07. (1) The adversarial review of task 7567a708 (run 365a9413, should-fix, medium) found that a task-less change assigned to a branch loses its assignment once it is split into tasks; Ryan chose inheritance: a change's own delivery.branch covers its open tasks that have none. (2) Task 423da32e raised the hench to rex gateway cap from 69 to 70 for currentWorkSet; Ryan's rule is to design an export away before raising a cap, so rex's selector works the set out itself and hench drops the import."
acceptanceCriteria:
  - "A task-less change assigned to a branch and later split into tasks keeps those tasks in the branch's work set"
  - "The hench to rex gateway is back at 69 exports and ndx work --resolve still shows the work set"
touches:
  - "7de075e7-b519-4f53-a17d-d0eea465530b"
priority: "high"
discoveredFrom: {"item":"7567a708-d942-448f-9869-3cbc2aed9bab","run":"365a9413-ae5b-426e-8d20-ec3941c4b395"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
