---
id: "9cea889f-17de-4b92-a97e-b7279e158578"
type: "capability"
title: "Calibrate the uncommitted-work guards: discount hench's own PRD writes and the tree-meta sidecar, and cover --epic-by-epic"
slug: "calibrate-the-uncommitted-work-guards"
statement: "Hench's uncommitted-work guards treat its own PRD status writes and the .rex/tree-meta.json sidecar as PRD commit paths, so autonomous loops keep running after a failed task while still stopping on leaked non-PRD changes, and --epic-by-epic runs get the same between-task check."
criteria: [{"id":"c1","text":"The completion gate shall treat .rex/tree-meta.json as a PRD commit path, so a run whose only dirt is a rewritten tree-meta.json sidecar completes."},{"id":"c2","text":"When autoCommit is enabled, hench shall include .rex/tree-meta.json in the completion commit if the file exists."},{"id":"c3","text":"When autoCommit is disabled, the commit prompt shall stage .rex/tree-meta.json alongside the PRD tree if the file exists."},{"id":"c4","text":"The between-task uncommitted-work guard shall disregard changes under the PRD commit paths, so a loop whose previous task left only a deferred or pending status write in .rex/prd_tree/ continues to the next task."},{"id":"c5","text":"If the previous task left uncommitted changes outside the PRD commit paths and hench runtime artifacts, the between-task guard shall stop the loop with exit code 1."},{"id":"c6","text":"While running with --epic-by-epic, hench shall run the between-task uncommitted-work guard before every task except the first task of the invocation, counting tasks across epics."},{"id":"c7","text":"If the between-task guard refuses during an --epic-by-epic run, hench shall stop the whole run with exit code 1 and print the same message as --loop."}]
priority: "critical"
---

Follow-up to PR #370 review (findings 1, 2, 10). Severity: critical — the between-task guard and the completion gate refuse in situations the PR's own code produces.

FAILURE SCENARIO A — every autonomous loop dies on its first failed task. In hench run --loop, task 1 fails or is deferred (timeout, spin, livelock, transient). handleRunFailure writes the deferred/pending status into .rex/prd_tree/<task>/index.md. Nothing commits it: performCommitPromptIfNeeded and commitCompletionMetadata only run when run.status is completed, and performRollbackIfNeeded never reverts unless interactive. Iteration 2: shouldStopForUncommittedWork (packages/hench/src/cli/commands/run.ts ~line 1506) discounts nothing but runtime artifacts, sees the dirty prd_tree, prints 'Stopping the loop', sets exitCode=1, breaks. The ConsecutiveFailureCounter and stuck-skip paths become unreachable.

FAILURE SCENARIO B — .rex/tree-meta.json refuses every completion. Every FolderTreeStore/FileStore save rewrites the tracked sidecar .rex/tree-meta.json (packages/rex/src/store/folder-tree-store.ts ~line 98). It is not in PRD_COMMIT_PATHS (packages/hench/src/agent/lifecycle/uncommitted-work-gate.ts line 45), not a hench runtime artifact, and never staged by performCommitPromptIfNeeded (stages only prd_tree and legacy prd.md) or commitPrdTreeIfStaged. Any project whose committed tree-meta.json predates the schema marker (this repo's merge base had {"title":"PRD"}) gets ' M .rex/tree-meta.json' on the first PRD write of a run, and the finalizeRun gate refuses every task forever. The same dirt defeats the #365 fix for --reset-deferred.

FAILURE SCENARIO C — --epic-by-epic has no between-task guard. shouldStopForUncommittedWork was wired into runIterations and runLoop only; runEpicByEpic iterates tasks in its own while(true) loop via runOne (run.ts ~line 2028) and never calls it, so the #363 tangling still happens there.

SOLUTION
- Treat .rex/tree-meta.json as a PRD commit path everywhere the folder tree is: add it to PRD_COMMIT_PATHS; stage it in commitPrdTreeIfStaged and in performCommitPromptIfNeeded's prdPaths (guard with existsSync — git add on a missing path errors). Consider a single exported constant for the sidecar path so the three call sites cannot drift.
- shouldStopForUncommittedWork must discount PRD_COMMIT_PATHS: hench's own failure-path status writes are legitimately uncommitted, and the completion gate already covers the completion case. Rewrite its docblock, whose premise ('uncommitted prd_tree means the previous task's status write never landed') only holds for successful tasks.
- Call the guard in runEpicByEpic before every runOne except the first task of the invocation (track a counter across epics); on refusal set stopping=true and break so the outer loop ends.

ACCEPTANCE CRITERIA
- Integration test: a --loop-style sequence where task 1 leaves only a deferred status write in prd_tree does NOT stop the loop; a leaked code file still does.
- Integration test: a run whose only dirt is a rewritten .rex/tree-meta.json completes, and the sidecar is included in the completion commit (autoCommit path) and staged by the commit prompt (non-autoCommit path).
- runEpicByEpic stops with exit code 1 when the previous task left non-PRD dirt, with the same message as --loop.
- Existing uncommitted-work-gate, uncommitted-work-completion and reset-deferred suites still pass; changeset for @n-dx/hench (patch).

Conventions: cross-package imports through packages/hench/src/prd/rex-gateway.ts; no node:child_process in hench; run pnpm test from the repo root before declaring done.
