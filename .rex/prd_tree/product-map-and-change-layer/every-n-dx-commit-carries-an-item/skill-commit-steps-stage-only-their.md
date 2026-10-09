---
id: "a707ecf8-cfd3-4408-b5ee-2ddec67469c6"
level: "task"
title: "Skill commit steps stage only their own changes"
status: "completed"
priority: "high"
source: "review"
startedAt: "2026-10-09T03:49:50.840Z"
completedAt: "2026-10-09T03:59:21.355Z"
endedAt: "2026-10-09T03:59:21.355Z"
acceptanceCriteria:
  - "The ndx-work, ndx-capture, ndx-plan, ndx-reshape and ndx-config commit steps stage the files the task or skill changed plus the .rex/prd_tree/ paths its MCP writes touched, by explicit path"
  - "No skill source, generated copy or the SKILLS.md template tells the agent to run `git add -A` or `git add .` (tests/e2e/skill-commit-isolation.test.js)"
  - "Files the operator had already modified and the task did not touch stay unstaged (test)"
description: "From Ryan's review of #605 (2026-10-08 23:33Z). The new /ndx-work commit step (packages/core/assistant-assets/skills/ndx-work.md step 13) runs `git add -A` at the end of a long assisted session in the operator's working tree, sweeping unrelated edits into a commit attributed to the task. Decision D1 (Ryan, 2026-10-08): fold in the same pre-existing `git add -A` in ndx-capture.md (step 9), ndx-plan.md (step 9), ndx-reshape.md (step 7) and ndx-config.md (step 2) here, since the worktree-safe scratch-file task edits every one of those commit steps. Decision D2: this task runs together with the scratch-file task as one assisted /ndx-work run, because the generated copies under .claude/skills/ must match the sources (tests/e2e/skill-sync.test.js) and hench agents cannot write under .claude/."
lastModified: "2026-10-09T03:59:22.215Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
