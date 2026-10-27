---
id: "d1e0b463-dd22-4ffd-b0e6-b711afd8f4f2"
type: "change"
title: "Stage PRD status transition write into the same commit that completes the task"
slug: "stage-prd-status-transition-write-into"
intent: "Currently hench updates the PRD folder tree (`.rex/tree/<slug>/index.md`) and commits code changes — the two writes can land in separate commits or leave the tree dirty. Reorder hench's run-completion flow so that after task acceptance, the status flip in `.rex/tree/` is staged alongside the code changes and included in the same commit. Add a regression test that checks out the resulting commit and confirms the PRD item is marked completed at that revision."
acceptanceCriteria:
  - "After a successful hench run, `.rex/tree/<slug>/index.md` shows status `completed` and the change is part of the same commit as the code changes"
  - "`git checkout <commit>` followed by `rex status` reports the item as completed at that revision"
  - "If the task is not actually accepted as complete (review mode declines, or rollback fires), the PRD status is not flipped and not included in any commit"
  - "Concurrent hench runs on different tasks do not cross-stage each other's PRD status writes (verified by integration test using two parallel slug paths)"
touches:
  - "e22db08b-4465-4fe8-ad4c-e9f99fc8b259"
priority: "critical"
tags:
  - "hench"
  - "commit"
  - "prd"
source: "smart-add"
---
