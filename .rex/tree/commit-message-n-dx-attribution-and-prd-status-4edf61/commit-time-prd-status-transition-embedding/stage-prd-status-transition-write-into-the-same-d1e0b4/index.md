---
id: "d1e0b463-dd22-4ffd-b0e6-b711afd8f4f2"
level: "task"
title: "Stage PRD status transition write into the same commit that completes the task"
status: "completed"
priority: "critical"
tags:
  - "hench"
  - "commit"
  - "prd"
source: "smart-add"
startedAt: "2026-04-29T18:48:34.716Z"
completedAt: "2026-04-29T18:54:55.035Z"
endedAt: "2026-04-29T18:54:55.035Z"
resolutionType: "code-change"
resolutionDetail: "Implemented deferred PRD status updates at commit time, staged PRD files alongside code changes, added regression tests"
acceptanceCriteria:
  - "After a successful hench run, `.rex/tree/<slug>/index.md` shows status `completed` and the change is part of the same commit as the code changes"
  - "`git checkout <commit>` followed by `rex status` reports the item as completed at that revision"
  - "If the task is not actually accepted as complete (review mode declines, or rollback fires), the PRD status is not flipped and not included in any commit"
  - "Concurrent hench runs on different tasks do not cross-stage each other's PRD status writes (verified by integration test using two parallel slug paths)"
description: "Currently hench updates the PRD folder tree (`.rex/tree/<slug>/index.md`) and commits code changes — the two writes can land in separate commits or leave the tree dirty. Reorder hench's run-completion flow so that after task acceptance, the status flip in `.rex/tree/` is staged alongside the code changes and included in the same commit. Add a regression test that checks out the resulting commit and confirms the PRD item is marked completed at that revision."
---

# Stage PRD status transition write into the same commit that completes the task

🔴 [completed]

## Summary

Currently hench updates the PRD folder tree (`.rex/tree/<slug>/index.md`) and commits code changes — the two writes can land in separate commits or leave the tree dirty. Reorder hench's run-completion flow so that after task acceptance, the status flip in `.rex/tree/` is staged alongside the code changes and included in the same commit. Add a regression test that checks out the resulting commit and confirms the PRD item is marked completed at that revision.

## Info

- **Status:** completed
- **Priority:** critical
- **Tags:** hench, commit, prd
- **Level:** task
- **Started:** 2026-04-29T18:48:34.716Z
- **Completed:** 2026-04-29T18:54:55.035Z
- **Duration:** 6m
