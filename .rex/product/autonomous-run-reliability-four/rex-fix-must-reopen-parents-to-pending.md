---
id: "a6970e26-d9db-4629-a1ef-7baba0f493f6"
type: "capability"
title: "rex fix must reopen parents to pending (not in_progress) and run the whole-tree stuck-parent sweep"
slug: "rex-fix-must-reopen-parents-to-pending"
statement: "rex fix repairs parent/child status misalignment: it reopens completed parents that still have open children to pending, and it runs a whole-tree sweep that completes pending parents whose children are all completed."
criteria: [{"id":"c1","text":"When rex fix repairs a completed parent that has children not yet completed, rex fix shall reopen the parent to pending rather than in_progress."},{"id":"c2","text":"rex fix shall treat only completed children as successful when it detects parent/child misalignment, so that it detects and repairs the same completed parent with a deferred child that rex validate warns about."},{"id":"c3","text":"rex fix shall provide a stuck-parent fix kind that runs the whole-tree reconciliation and sets a pending parent whose children are all completed to completed, with completedAt recorded."},{"id":"c4","text":"When the stuck-parent fix completes nested parents, rex fix shall process them bottom-up, completing a feature before its epic."},{"id":"c5","text":"The rex fix command shall show an icon and a label for the stuck-parent fix kind."},{"id":"c6","text":"The auto-completion reconciliation shall complete only pending parents, never in_progress ones."}]
priority: "high"
---

Follow-up to PR #370 review (findings 7, 8). Severity: high — after #368 the repair tool creates parents that can never auto-complete, and the self-heal the code still advertises runs nowhere.

FAILURE SCENARIO A — rex fix strands parents. applyParentChildFixes in packages/rex/src/fix/index.ts (~line 153) repairs a completed parent with open children by setting it to in_progress. AUTO_COMPLETABLE_STATUSES in packages/rex/src/core/parent-completion.ts is now {pending} (#368: in_progress is an explicit claim), so when the last child later completes, findAutoCompletions and reconcileAutoCompletions break on the parent and it stays in_progress forever. The only signal is the print-only rex status hint. fix/index.ts also keeps its own terminal set {completed, deferred, cancelled, deleted} while structural.ts now uses SUCCESSFUL_CHILD_STATUSES = {completed}, so rex validate warns about completed-parent + deferred-child while rex fix proposes nothing for it.

FAILURE SCENARIO B — whole-tree self-heal is gone. hench's toolRexUpdateStatus (packages/hench/src/tools/rex.ts ~line 166) now passes ancestorsOf; no code path in rex CLI, MCP or web runs the unscoped sweep. Epic E has feature F1 stuck pending under fully completed children (an earlier lost cascade) and F2 with one task T; completing T completes F2 but F1 is outside the scope and not marked virtually complete, so E never completes. Pre-PR the whole-tree sweep healed F1 in the same call. reconcileAutoCompletions' docblock still says it returns 'pending or in_progress' parents and still promises self-healing.

SOLUTION
- applyParentChildFixes / detectParentChildMisalignment: reopen to pending (the codebase's reopen convention — cascadeParentReset in core/parent-reset.ts also uses pending), and use the completed-only child predicate so fix repairs exactly what validate warns about. Decide and document whether cancelled/deleted children should keep blocking; if not, that exception belongs in SUCCESSFUL_CHILD_STATUSES, not in a private copy.
- Add a fix kind (e.g. stuck_parent) that runs the whole-tree reconciliation — a pending parent whose children are all completed becomes completed with completedAt — so the operator has an explicit path to heal what agent runs no longer touch. Keep the fix zone's structural FixItem shape; if reusing reconcileAutoCompletions requires an import into fix/, note the zone coupling in packages/rex/CLAUDE.md.
- Fix the reconcileAutoCompletions docblock: only pending parents; unscoped sweeps are an operator action (rex fix), not an agent-run side effect.

ACCEPTANCE CRITERIA
- tests/unit/fix/index.test.ts: parent reopens to pending; a completed parent with a deferred child is now detected and repaired; a pending parent with all-completed children is completed by the new fix kind; bottom-up order (feature before epic).
- cli/commands/fix tests updated for the new kind's icon/label.
- packages/rex/tests/unit/core/parent-completion.test.ts unchanged in behaviour; changeset for @n-dx/rex (patch).

Note for the model: remove-task.ts, structural.ts and status-sections.ts already import the shared predicates — do not reintroduce local copies.
