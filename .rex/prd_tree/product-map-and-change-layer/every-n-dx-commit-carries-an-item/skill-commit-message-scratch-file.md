---
id: "961d0625-2aad-4cb9-b7ba-f621cbe4616b"
level: "task"
title: "Skill commit-message scratch file works in linked worktrees"
status: "pending"
priority: "high"
source: "review"
acceptanceCriteria:
  - "Every skill commit step writes the message to a uniquely named file in the OS temp directory (from `node -p \"require('os').tmpdir()\"`), commits with `git commit -F` on that literal path and deletes it by the same literal path"
  - "The SKILLS.md skill-author template says the same"
  - "A test fails if a skill source, a generated copy or the template names `.git/NDX_COMMIT_MSG` (or any scratch path under .git/) literally"
  - "The generated .claude/skills/ copies match the sources (tests/e2e/skill-sync.test.js)"
description: "From Ryan's review of #605 (2026-10-08 23:33Z). Every skill commit step (ndx-adversarial-review.md ~141-150, ndx-capture.md ~16-26, ndx-config.md ~23-32, ndx-plan.md ~20-29, ndx-reshape.md ~30-39, ndx-work.md ~15-25) and the skill-author template in packages/core/assistant-assets/SKILLS.md (lines 53 and 62) write `.git/NDX_COMMIT_MSG`. In a linked worktree `.git` is a file, so the write fails with \"not a directory\". Decision (Ryan, 2026-10-08): write the scratch file to the OS temp directory, not under .git. `git rev-parse --git-path NDX_COMMIT_MSG` was ruled out because in a Claude desktop worktree session it resolves to <main>/.git/worktrees/<name>/, which the app's Write hook refuses as the base checkout, and Claude Code's safety check refuses `rm \"$M\"` on a path taken from git rev-parse (both seen 2026-10-08 committing this task's capture). The step: get the temp directory with `node -p \"require('os').tmpdir()\"`, write the message there with the file-writing tool under a unique name (e.g. ndx-commit-<random>.txt), run `git commit -F <that literal path>`, then delete it by the same literal path, never through a shell variable. Decision D2 (Ryan, 2026-10-08): runs together with the stage-own-changes task as one assisted /ndx-work run; regenerate the .claude/skills/ copies so tests/e2e/skill-sync.test.js passes."
lastModified: "2026-10-09T03:32:27.105Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
