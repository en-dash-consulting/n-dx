---
id: "02380e14-8e07-4650-b871-427ce7108f5f"
level: "task"
title: "prompt-census --write stamps commit 'unknown' in a git worktree, producing a baseline its own gate rejects"
status: "pending"
priority: "medium"
acceptanceCriteria: []
description: "currentCommit() in scripts/prompt-census.mjs (~line 1697) resolves the HEAD sha by reading .git/HEAD as a path under a directory. In a git worktree .git is a *file* containing 'gitdir: <path>', so readGitFile returns null and the function falls through to 'unknown'. tests/e2e/prompt-census.test.js:368 then asserts baseline.commit matches /^[0-9a-f]{7,40}$/ and fails, so the writer produces a baseline the gate rejects. Reproduced 2026-09-10 regenerating the baseline after merging #356 into feature/auditing-improvements-batch-2, from .claude/worktrees/prd-overview-workflow-4de008; the JSON and the md both recorded 'unknown' and the run was unblocked only by hand-stamping the sha. Worktrees are a normal working mode here — CLAUDE.md documents them and the repo's own sessions run in them — so anyone regenerating from one hits this. Fix: resolve the real gitdir before reading HEAD (when .git is a file, parse its 'gitdir:' line and read HEAD from there; a linked worktree's HEAD lives in that directory). The packed-refs fallback needs the same base path. Worth a test that runs the resolver from a worktree fixture, since the whole class is invisible from a normal checkout."
lastModified: "2026-09-10T19:00:16.533Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
