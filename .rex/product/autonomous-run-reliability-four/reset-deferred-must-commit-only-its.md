---
id: "eb4ec55f-22c8-4488-92d1-5154156897a2"
type: "capability"
title: "--reset-deferred must commit only its own writes and must not write on --dry-run"
slug: "reset-deferred-must-commit-only-its"
statement: "When an operator runs `hench run --reset-deferred`, hench resets deferred and failing tasks and commits only its own reset writes, and it commits only when the PRD tree was clean before the reset; with `--dry-run` it lists the tasks it would reset and writes nothing."
criteria: [{"id":"c1","text":"Before resetting deferred tasks, hench shall record whether any PRD commit path (the `.rex/prd_tree` folder tree or the tree-meta sidecar) already has uncommitted changes."},{"id":"c2","text":"If any PRD commit path had uncommitted changes before the reset, hench shall not commit the reset automatically."},{"id":"c3","text":"If any PRD commit path had uncommitted changes before the reset, hench shall print why it did not commit the reset."},{"id":"c4","text":"If any PRD commit path had uncommitted changes before the reset, hench shall leave the operator's uncommitted PRD edits unstaged and uncommitted."},{"id":"c5","text":"If any PRD commit path had uncommitted changes before the reset, the pre-run gate shall refuse the run with exit code 1."},{"id":"c6","text":"When the PRD tree was clean before the reset and at least one task is reset, hench shall commit the reset automatically and proceed with the run."},{"id":"c7","text":"When the reset changes no task, hench shall not run any git operation for the reset."},{"id":"c8","text":"When `--reset-deferred` is combined with `--dry-run`, hench shall list the tasks it would reset and return their count without writing to the PRD."},{"id":"c9","text":"When `--reset-deferred` is combined with `--dry-run`, hench shall leave `git status` clean."}]
priority: "high"
---

Follow-up to PR #370 review (finding 9). Severity: high — a resume flag silently commits the operator's unrelated PRD edits under a misleading message, in a TTY, with no prompt.

FAILURE SCENARIO
Operator has hand-edited .rex/prd_tree/epic-x/index.md (uncommitted) and runs hench run --reset-deferred. resetDeferredTasks resets ≥1 task → commitResetDeferredChanges → commitPrdTreeIfStaged does git add .rex/prd_tree (packages/hench/src/agent/lifecycle/shared.ts ~line 1298), staging the operator's half-finished edit too → both are committed as 'chore(prd): reset N deferred/failing task(s)' with a Co-Authored-By trailer before the pre-run gate ever sees the tree. Before #370 the gate would have shown the dirt and refused or asked. Related: resetDeferredTasks (packages/hench/src/cli/commands/run.ts ~line 355) still writes on --dry-run, but cmdRun skips the commit when dryRun, so --dry-run --reset-deferred leaves a dirty tree that the next real autonomous run refuses with exit 1.

SOLUTION
- Before the reset, record whether any PRD commit path (prd_tree, tree-meta sidecar) is already dirty — expose a helper from uncommitted-work-gate.ts (e.g. listUncommittedPrdPaths(projectDir)) rather than duplicating the porcelain matching in run.ts. If the tree was already dirty, do NOT auto-commit the reset: print why, leave everything for the pre-run gate to report (its refusal already exits 1). Only a PRD tree that was clean before the reset gets the automatic commit.
- resetDeferredTasks takes a dryRun option: list what would be reset, write nothing, return the count.
- Update the module comment on commitResetDeferredChanges to state the precondition.

ACCEPTANCE CRITERIA
- reset-deferred-pre-run-gate suite gains: (a) PRD tree dirty before the reset → no commit is made, the operator's edit is untouched, the gate refuses with exit 1; (b) --dry-run resets nothing and leaves git status clean.
- Existing cases (clean tree resets and proceeds; genuinely dirty tree still stops; no-op reset never touches git) still pass; changeset for @n-dx/hench (patch).
