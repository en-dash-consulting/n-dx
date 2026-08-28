---
id: "544d93d2-10f8-45a6-815b-5a7664d6a65c"
level: "task"
title: "--review leaves the PRD completion metadata uncommitted when the agent commits its own work anyway"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "review-pass"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "After a --review run in which the agent committed its own work and left nothing staged and no .hench-commit-msg.txt, finalizeRun commits the PRD completion metadata instead of leaving .rex/prd_tree dirty"
  - "A test covers: review-enabled run, agent self-commit, no message file → git status is clean after finalizeRun"
description: "Verdict: should-fix (severity low). --review forces effectiveAutoCommit off (cli-loop.ts:1500-1509), so commitCompletionMetadata (shared.ts:2122) — gated on opts.autoCommit — never runs on a review-enabled run. The executor is only instructed not to commit; git commit stays in its allowed commands, and the HEAD-move warning at the top of runAdversarialReviewPass exists because that path is anticipated. Scenario: --review run with hench.autoCommit true; the agent follows its autoCommit habit, commits its work itself, and leaves nothing staged and no .hench-commit-msg.txt → performCommitPromptIfNeeded exits early (no message file, or stagedCount 0 at shared.ts:1533), and the PRD completion metadata written by updateCompletedTaskStatus (shared.ts:2081) is left dirty in .rex/prd_tree. The next run's pre-run commit gate sweeps it into a 'chore: commit local changes before hench run' commit attributed to nothing.\n\nReachability: any --review run where the spawned agent self-commits — the same disobedience path the HEAD-move warning already reports.\n\nSolutions: (A, recommended) commit the completion metadata whenever the run completed but this finalize made no commit — i.e. relax the opts.autoCommit gate on commitCompletionMetadata to also cover the review-override case where performCommitPromptIfNeeded returned without committing; a few lines plus a test. (B) extend the HEAD-move warning to say the PRD completion metadata will be left uncommitted — honesty only, the residue remains."
lastModified: "2026-08-28T16:01:48.627Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
