---
id: "961d0625-2aad-4cb9-b7ba-f621cbe4616b"
level: "task"
title: "Skill commit-message scratch file works in linked worktrees"
status: "pending"
priority: "high"
source: "review"
acceptanceCriteria:
  - "Every skill commit step resolves the scratch path with `git rev-parse --git-path NDX_COMMIT_MSG`, commits with `git commit -F` on that path and deletes it"
  - "The SKILLS.md skill-author template says the same"
  - "A test fails if a skill source, a generated copy or the template names `.git/NDX_COMMIT_MSG` literally"
  - "The generated .claude/skills/ copies match the sources (tests/e2e/skill-sync.test.js)"
description: "From Ryan's review of #605 (2026-10-08 23:33Z). Every skill commit step (ndx-adversarial-review.md ~141-150, ndx-capture.md ~16-26, ndx-config.md ~23-32, ndx-plan.md ~20-29, ndx-reshape.md ~30-39, ndx-work.md ~15-25) and the skill-author template in packages/core/assistant-assets/SKILLS.md (lines 53 and 62) write `.git/NDX_COMMIT_MSG`. In a linked worktree `.git` is a file, so the write fails with \"not a directory\". Resolve the path with `git rev-parse --git-path NDX_COMMIT_MSG` (.git/worktrees/<name>/NDX_COMMIT_MSG in a worktree). Decision D2 (Ryan, 2026-10-08): runs together with the stage-own-changes task as one assisted /ndx-work run; regenerate the .claude/skills/ copies so tests/e2e/skill-sync.test.js passes."
lastModified: "2026-10-09T03:21:22.081Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
