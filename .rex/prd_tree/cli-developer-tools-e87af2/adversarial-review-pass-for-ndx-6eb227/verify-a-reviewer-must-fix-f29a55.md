---
id: "f29a5567-c0a9-47ab-a1c2-ed8d5ec1f700"
level: "task"
title: "Verify a reviewer must-fix repair reaches the run's commit on a live run"
status: "pending"
priority: "medium"
tags:
  - "review-pass"
  - "e2e-finding"
  - "verification"
source: "ndx-capture"
acceptanceCriteria:
  - "A live --review run is recorded in which the report has fixesApplied=true and at least one finding with verdict must-fix and action fixed"
  - "The file the reviewer repaired is present in that run's commit, verified by git show against the commit SHA, not merely by the report's claim"
  - "The repair is confirmed to have been staged before performCommitPromptIfNeeded ran (HEAD unchanged through the review, commit produced by the run rather than by the executor or the auto-commit timer)"
  - "The run record's review block and token totals are checked against the same run, as was done for run ea962353"
description: "The remaining gap from the e2e verification in task 0deece15. Run ea962353 exercised the spawn path fully — the reviewer resumed the work session on the override model, wrote a parseable report, captured a finding to the PRD, and charged its tokens to the run — but it found no must-fix, so `fixesApplied` was false and the repair path never executed. Three of that task's four checks are evidenced; this one is not.\n\nWhat is covered today: `packages/hench/tests/unit/agent/review-repair-staging.test.ts` drives processSuccessfulResult with a stub reviewer that edits a tracked file without staging and asserts the repair reaches HEAD. That is the mechanism, at unit level, with a stubbed spawn. What is not covered is the same path with a real reviewer deciding on its own to edit source mid-run.\n\nAdjacent evidence from ea962353, short of the real thing: the reviewer's own PRD writes (item 0c587080, which it captured) are in the run's commit, so reviewer-authored files written before the commit prompt do land in it. The reviewer also staged its writes itself, which is the behaviour the prompt instruction from task e168b824 asks for.\n\nA live must-fix cannot be forced on a real task — the reviewer either finds one or does not. The practical route is a controlled run: initialise a throwaway project (ndx init in a temp dir), give it a task whose expected implementation carries a defect a reviewer will call must-fix, run `ndx work --review` against it, and inspect the report and the resulting commit. That keeps the verification off this repo's history."
lastModified: "2026-08-28T17:47:59.524Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
