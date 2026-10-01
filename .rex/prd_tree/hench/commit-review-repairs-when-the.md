---
id: "c6d1041e-9e6f-4524-b7ee-79148345cf8e"
level: "task"
title: "Commit review repairs when the executor committed for itself and left no commit message"
status: "pending"
priority: "critical"
tags:
  - "hotfix"
  - "hench"
  - "run-lifecycle"
  - "review"
source: "ndx-capture"
acceptanceCriteria:
  - "With autoCommit false, an executor that committed its own work with no .hench-commit-msg.txt, and a review that repaired a file, the run completes and the run produced two commits: the executor's and a `fix(review): apply adversarial-review repairs (run <id>)` commit holding the repairs"
  - "If hench cannot make that commit, the refusal names the cause (review repairs uncommitted: the executor committed without a message file) instead of the generic uncommitted-work message, and its hint gives the two-command recovery: commit the repaired paths, then `ndx rex update <id> --status=completed`"
  - "When the executor did not commit (HEAD still at startHead) or other work is still dirty, hench does not commit the repairs and the existing refusal is unchanged (run 2fb96507 behaviour)"
  - "The commit prompt path (non-empty .hench-commit-msg.txt) and the autoCommit path behave as before"
description: "GitHub issue #483 (caos run 4b733f14). With hench.autoCommit false, review repairs are committed only by the commit prompt, which stages them before `git commit -F .hench-commit-msg.txt` and returns early when that file is missing or empty. When the executor commits its own work with `git commit` and writes no message file, nothing commits the repairs, and since #422 the completion gate correctly refuses them, so a run whose work and repairs were both correct ends failed and its task is reset to pending. `commitReviewRepairs` already exists but only the autoCommit path calls it. Fix: when the review produced repairs, no commit prompt will follow, the executor committed during the run (HEAD moved past startHead) and nothing but the repairs and PRD paths is dirty, hench commits the repairs itself as a follow-up `fix(review): apply adversarial-review repairs (run <id>)` commit before the gate checks the tree."
lastModified: "2026-10-01T19:12:34.370Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
