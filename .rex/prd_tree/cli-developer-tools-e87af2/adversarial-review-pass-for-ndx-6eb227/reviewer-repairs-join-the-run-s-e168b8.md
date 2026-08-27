---
id: "e168b824-aa84-4e7b-b43a-ad2833b113d6"
level: "task"
title: "Reviewer repairs join the run's commit only if the reviewer voluntarily stages them"
status: "pending"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
  - "review-pass"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "The reviewer prompt explicitly instructs staging (`git add`) every file a must-fix repair touches"
  - "After a review pass whose report says fixesApplied, hench restages tracked modifications (e.g. git add -u) before performCommitPromptIfNeeded, so an unstaged repair cannot be silently dropped"
  - "A test asserts that a repair left unstaged by the reviewer is still included in the run's commit"
description: "Verdict: should-fix (severity high; pre-existing — the reviewer prompt predates the current branch, but the --review commit-ownership work re-asserts the guarantee it undermines). The reviewer prompt says 'Do not commit. The run commits after you finish; your fixes are picked up by that commit' (adversarial-review.ts:323-325) but never instructs staging, and nothing restages after the review pass: the final commit is `git commit -F` — index only (shared.ts:1707) — and the only post-review staging is the .rex/ PRD paths (shared.ts:1598-1603). The executor's `git add -A` ran before the reviewer's edits. Scenario: reviewer applies a must-fix to a tracked file, does not run `git add`, records action:'fixed' in the report → the run's commit ships without the repair while the report claims it was applied; the dirty repair is swept into the next run's `git add -A`, attributing it to unrelated work.\n\nReachability: every --review run with must-fix repairs where the spawned reviewer does not voluntarily stage — nothing in the prompt or pipeline makes staging happen.\n\nSolutions: (A, recommended) one line in the reviewer prompt: stage every file you fix. (B, belt-and-braces, also recommended) after a review pass whose report says fixesApplied, run `git add -u` (tracked modifications only — cannot sweep unrelated untracked files) before performCommitPromptIfNeeded. A+B together closes it cheaply."
lastModified: "2026-08-27T23:28:08.231Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
