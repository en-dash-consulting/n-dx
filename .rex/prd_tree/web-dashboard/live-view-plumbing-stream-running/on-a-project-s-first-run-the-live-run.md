---
id: "3a49fd9c-e485-4149-ac53-2f7894596914"
level: "task"
title: "On a project's first run the live .run-logs file is not git-ignored, so --review commits it as a review repair"
status: "pending"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
  - "live"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "Creating `.run-logs/` also writes `.run-logs/.gitignore` containing `*`, so `git status --porcelain` never lists a run log during or after a run."
  - "A review pass in a repository with no `.run-logs/` ignore line does not list the run log in `repairedFiles` (test)."
  - "An agent `git add -A` during a first run does not stage the run log (test or assertion on git status)."
  - "Changeset for @n-dx/hench (patch)."
description: "Failure: the incremental log is opened at run start (`packages/hench/src/agent/lifecycle/shared.ts:637-645`) but `ensureRunLogsIgnored` adds `.run-logs/` to `.gitignore` only at the end of the run (`shared.ts:534`). In any project whose `.gitignore` has no `.run-logs/` line yet (every project's first run), `.run-logs/<ts>-<id>.log` is an untracked file that grows during the run. With `--review`, `snapshotDirtyState` (`agent/analysis/review-repairs.ts:41-66`) runs before and after the reviewer; the log's hash changes as the reviewer's output streams into it, and the filter in `agent/lifecycle/cli-loop.ts:1561-1563` drops only `.rex/` and `.hench/`, so the log is listed in `review.repairedFiles` and committed by `commitReviewRepairsIfNeeded` (or staged at `shared.ts:1545` interactively). Same root cause: an agent that runs `git add -A && git commit` during its first run now sweeps the log into the task commit; before this branch the log did not exist until after the commits. `artifacts.ts` lists `.run-logs/` as runtime, but only the completion and uncommitted-work gates use that list.\n\nReachability: the first `ndx work --review` in any project. Verified in code. No test covers it.\n\nVerdict: must-fix (severity high).\n\nOptions:\n- (a) Recommended: have the log-directory setup write `.run-logs/.gitignore` containing `*` when it creates the directory, so git never sees the logs and no tracked file is edited mid-run. Fixes both paths. Small.\n- (b) Add `.run-logs/` to the cli-loop repair filter. Fixes only the review path."
lastModified: "2026-10-01T15:21:40.644Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
