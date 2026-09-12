---
id: "eb4ec55f-22c8-4488-92d1-5154156897a2"
level: "task"
title: "--reset-deferred must commit only its own writes and must not write on --dry-run"
status: "completed"
priority: "high"
startedAt: "2026-09-12T08:05:17.377Z"
completedAt: "2026-09-12T08:14:45.964Z"
endedAt: "2026-09-12T08:14:45.964Z"
acceptanceCriteria: []
description: "Follow-up to PR #370 review (finding 9). Severity: high — a resume flag silently commits the operator's unrelated PRD edits under a misleading message, in a TTY, with no prompt.\n\nFAILURE SCENARIO\nOperator has hand-edited .rex/prd_tree/epic-x/index.md (uncommitted) and runs hench run --reset-deferred. resetDeferredTasks resets ≥1 task → commitResetDeferredChanges → commitPrdTreeIfStaged does git add .rex/prd_tree (packages/hench/src/agent/lifecycle/shared.ts ~line 1298), staging the operator's half-finished edit too → both are committed as 'chore(prd): reset N deferred/failing task(s)' with a Co-Authored-By trailer before the pre-run gate ever sees the tree. Before #370 the gate would have shown the dirt and refused or asked. Related: resetDeferredTasks (packages/hench/src/cli/commands/run.ts ~line 355) still writes on --dry-run, but cmdRun skips the commit when dryRun, so --dry-run --reset-deferred leaves a dirty tree that the next real autonomous run refuses with exit 1.\n\nSOLUTION\n- Before the reset, record whether any PRD commit path (prd_tree, tree-meta sidecar) is already dirty — expose a helper from uncommitted-work-gate.ts (e.g. listUncommittedPrdPaths(projectDir)) rather than duplicating the porcelain matching in run.ts. If the tree was already dirty, do NOT auto-commit the reset: print why, leave everything for the pre-run gate to report (its refusal already exits 1). Only a PRD tree that was clean before the reset gets the automatic commit.\n- resetDeferredTasks takes a dryRun option: list what would be reset, write nothing, return the count.\n- Update the module comment on commitResetDeferredChanges to state the precondition.\n\nACCEPTANCE CRITERIA\n- reset-deferred-pre-run-gate suite gains: (a) PRD tree dirty before the reset → no commit is made, the operator's edit is untouched, the gate refuses with exit 1; (b) --dry-run resets nothing and leaves git status clean.\n- Existing cases (clean tree resets and proceeds; genuinely dirty tree still stops; no-op reset never touches git) still pass; changeset for @n-dx/hench (patch)."
lastModified: "2026-09-12T08:14:46.266Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
