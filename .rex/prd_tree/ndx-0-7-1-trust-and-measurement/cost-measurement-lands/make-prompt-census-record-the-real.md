---
id: "64dfd262-724c-400b-8355-90975f8e03c5"
level: "task"
title: "Make prompt-census record the real commit when run from a worktree"
status: "completed"
priority: "low"
tags:
  - "0.7.1"
  - "cost-measurement"
  - "wm-2053"
source: "caos work management: WM2053 (Make prompt-census record the real commit when run from a worktree); 0.7.1 execution plan PR group"
startedAt: "2026-09-22T19:47:03.000Z"
completedAt: "2026-09-23T13:15:27.000Z"
endedAt: "2026-09-23T13:15:27.000Z"
resolutionType: "code-change"
resolutionDetail: "currentCommit() resolves the gitdir (following a linked worktree's `gitdir:` file) and the common dir, reads HEAD from the former and loose or packed refs from the latter, and falls back to `git rev-parse HEAD` before answering 'unknown'. tests/e2e/prompt-census.test.js drives it against a throwaway repo with a linked worktree across loose branch, packed branch and detached HEAD; the dirty-tree rule is unchanged. No changeset: scripts/ is not in the published package."
acceptanceCriteria:
  - "Running `node scripts/prompt-census.mjs --write` from a linked worktree stamps the worktree's HEAD SHA."
  - "tests/e2e/prompt-census.test.js gains a worktree case and passes."
  - "The dirty-tree behaviour from the earlier fix is unchanged."
description: "scripts/prompt-census.mjs --write publishes the prompt-token baseline (docs/analysis/prompt-token-baseline.json and .md) stamped with the commit it measured; tests/e2e/prompt-census.test.js gates on that stamp. A fix already landed for the dirty-working-tree case, but when the script runs inside a linked git worktree it stamps 'commit: unknown', so the writer produces a baseline its own gate rejects and nobody can regenerate it from a worktree. Verify the remaining defect against main and fix commit resolution for worktrees.\n\nImplementation notes: Reproduce by creating a linked worktree (`git worktree add`) of the repository and running `node scripts/prompt-census.mjs --write` there; confirm the commit field reads 'unknown'. Fix the commit resolution in scripts/prompt-census.mjs so it resolves HEAD for the directory being measured (for example `git -C <dir> rev-parse HEAD`, which works in linked worktrees) rather than assuming the main checkout's .git directory, keeping the existing dirty-tree stamping rule. Add a worktree case to tests/e2e/prompt-census.test.js. Changeset: @n-dx/core patch only if the script is part of the published package; otherwise none."
lastModified: "2026-09-23T13:15:27.000Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
