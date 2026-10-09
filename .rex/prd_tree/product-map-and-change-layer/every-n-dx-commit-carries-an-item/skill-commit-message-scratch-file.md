---
id: "961d0625-2aad-4cb9-b7ba-f621cbe4616b"
level: "task"
title: "Skill commit-message scratch file works in linked worktrees"
status: "completed"
priority: "high"
source: "review"
startedAt: "2026-10-09T03:49:54.542Z"
completedAt: "2026-10-09T03:59:24.669Z"
endedAt: "2026-10-09T03:59:24.669Z"
acceptanceCriteria:
  - "Every skill commit step writes the message to `.ndx-commit-msg.txt` at the project root, commits with `git commit -F .ndx-commit-msg.txt` and deletes it by that literal path"
  - "The SKILLS.md skill-author template says the same"
  - "A test fails if a skill source, a generated copy or the template names a scratch path under .git/ (such as `.git/NDX_COMMIT_MSG`)"
  - "The generated .claude/skills/ and .agents/skills/ copies match the sources (tests/e2e/skill-sync.test.js)"
description: "From Ryan's review of #605 (2026-10-08 23:33Z). Every skill commit step (ndx-adversarial-review, ndx-capture, ndx-config, ndx-plan, ndx-reshape, ndx-work) and the skill-author template in packages/core/assistant-assets/SKILLS.md (lines 53 and 62) write `.git/NDX_COMMIT_MSG`. In a linked worktree `.git` is a file, so the write fails with \"not a directory\". Decision (Ryan, 2026-10-08, revised while planning the assisted run): the scratch file is `.ndx-commit-msg.txt` at the project root, written with the file-writing tool, committed with `git commit -F .ndx-commit-msg.txt` and deleted by that literal path. Ruled out: `git rev-parse --git-path` (a Claude desktop worktree session cannot write to <main>/.git/worktrees/<name>/, and Claude Code refuses `rm \"$M\"` on a path from git rev-parse) and the OS temp directory (outside the project, so Claude Code asks permission on every skill commit). The explicit-path staging rule of the sibling stage-own-changes task keeps the file out of the commit. Decision D2: runs together with that task as one assisted /ndx-work run; regenerate the .claude/skills/ and .agents/skills/ copies so tests/e2e/skill-sync.test.js passes."
lastModified: "2026-10-09T03:59:24.926Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
