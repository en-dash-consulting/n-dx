---
id: "8b7df3ed-872c-4af3-813b-e6e913d44632"
level: "task"
title: "Commit-message watcher auto-commits mid-review, splitting or dropping the reviewer's repairs"
status: "pending"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
  - "review-pass"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "The commit-message watcher's auto-commit timer cannot fire while the adversarial review pass is running"
  - "On a --review run whose review pass exceeds commitMsgTimeoutMs, the reviewer's staged repairs land in the run's single commit (verified by git show on a real or simulated run)"
  - "performCommitPromptIfNeeded is never skipped via didAutoCommit() on a run where the review pass applied repairs"
  - "A regression test spawns/simulates a review pass longer than the watcher timeout and asserts no mid-review commit occurs"
description: "Verdict: must-fix (severity high). On a --review run the executor stages its work and writes .hench-commit-msg.txt (the resolveEffectiveAutoCommit override). startCommitMsgWatcher arms a one-shot timer the moment that file appears (commitMsgTimeoutMs, default 300_000 — cli-loop.ts:1606), and the watcher is cancelled only at cli-loop.ts:1788, AFTER processSuccessfulResult and therefore after the entire review pass. A review session routinely runs longer than 5 minutes, so the timer fires mid-review: tryAutoCommit (commit-msg-watcher.ts:107-145) runs `git commit -F` on the executor's staged work while the reviewer is still repairing. HEAD moves, so repairs can no longer join the commit they repair — the exact guarantee the --review commit-ownership fix (task 976d34af) introduces. Worse, performCommitPromptIfNeeded then sees didAutoCommit() and returns early (shared.ts:1501), so any repairs the reviewer staged are never committed by hench at all — they dangle in the working tree and are swept into the NEXT run's `git add -A`. The HEAD-moved warning added by 976d34af checks only at the START of the review pass (cli-loop.ts:1104), so a mid-review fire is silent.\n\nReachability: every `ndx work --review` run whose review pass exceeds commitMsgTimeoutMs — the common case for a substantive review. For hench.autoCommit:true users this window is newly created by the override (they previously never wrote the message file); for default users it pre-existed but was masked before repairs mattered.\n\nSolutions: (A, recommended) cancel/suspend the commit watcher before runAdversarialReviewPass and let the imminent performCommitPromptIfNeeded own the commit — few lines plus a test; risk: the crash-net is absent during the review window, acceptable because a reviewer crash leaves staged work + message file that the pre-run commit gate already handles. (B) pass timeoutMs:0 when --review is on — simpler but loses the net for the executor phase too. (C) post-review didAutoCommit check with a repair follow-up commit — does not prevent the split; weakest."
lastModified: "2026-08-27T23:28:07.146Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
