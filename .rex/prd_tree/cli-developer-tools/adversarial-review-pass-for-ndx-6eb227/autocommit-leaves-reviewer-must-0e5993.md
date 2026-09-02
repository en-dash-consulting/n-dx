---
id: "0e599306-9ff4-463d-8b45-ea794a937569"
level: "task"
title: "autoCommit leaves reviewer must-fix repairs uncommitted when the executor self-commits"
status: "completed"
priority: "high"
tags:
  - "hench"
  - "review-pass"
  - "git"
source: "ndx-work-e2e-verification"
startedAt: "2026-08-28T18:59:48.595Z"
completedAt: "2026-08-28T19:07:16.126Z"
endedAt: "2026-08-28T19:07:16.126Z"
acceptanceCriteria:
  - "After an autonomous run with --review in which the reviewer applies fixes, no repair file remains uncommitted at run end"
  - "Repairs are committed with run-scoped trailers, either together with the task's work commit or as an immediately following commit that references the run"
  - "A regression test covers the executor-self-commit + reviewer-repair sequence on the autoCommit path"
description: "On the --yes/auto path, commitCompletionMetadata (packages/hench/src/agent/lifecycle/shared.ts:1224) stages only .rex/prd_tree because the executor is expected to have committed its own work — which it has, before the review pass runs. The reviewer is barred from committing, so its in-session must-fix repairs remain uncommitted in the working tree when the run ends, violating the feature contract that repairs ship in the same commit as the work they repair (.changeset/ndx-work-review-pass.md). Observed end-to-end in run 4b4526c5 (branch tmp/review-e2e-mustfix): the executor committed its work as 31e28610, the reviewer repaired 4 must-fix findings, and the final commit f64703c5 contained only 2 PRD files — the repairs were left dirty. Uncommitted repairs are then swept into whatever commit happens next (e.g. the next run's pre-run gate commit, which uses git add -A), detaching them from the work they repair."
lastModified: "2026-08-28T19:07:16.132Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
