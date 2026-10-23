---
id: "ecb154ec-3916-4cd6-afd3-1cb15200ac3a"
type: "capability"
title: "Withdrawing a completion must reopen the ancestors the agent's own cascade already closed"
slug: "withdrawing-a-completion-must-reopen"
statement: "When an agent's task completion is withdrawn, the agent reopens every consecutive completed ancestor of that task, bottom-up, so that no completed parent is left above a pending child."
criteria: [{"id":"c1","text":"When an agent withdraws a task's completion, the agent shall reset the task's parent to pending if that parent was completed by the task's completion cascade."},{"id":"c2","text":"When an agent withdraws a task's completion, the agent shall reset the task's grandparent to pending if the completion cascade completed that grandparent."},{"id":"c3","text":"When an agent withdraws a task's completion, the agent shall also reopen a completed ancestor that was completed before the run, because that ancestor now has a pending descendant."},{"id":"c4","text":"When an agent reopens an ancestor after a withdrawn completion, the agent shall clear that ancestor's completion timestamp."},{"id":"c5","text":"When an agent reopens an ancestor after a withdrawn completion, the agent shall leave the ancestor's lastModifiedBy unchanged."},{"id":"c6","text":"When an agent reopens an ancestor after a withdrawn completion, the agent shall record a status_reset log entry whose detail says the child's completion was withdrawn."},{"id":"c7","text":"If reopening an ancestor fails during a withdrawn completion, the agent shall continue without throwing an error."}]
priority: "high"
---

Follow-up to PR #370 review (finding 6). Severity: high — leaves the PRD in the parent-child inconsistency state that rex validate warns about, with no path that repairs it.

FAILURE SCENARIO
Feature F (pending) has one remaining task T. The agent calls rex_update_status(T, completed) → toolRexUpdateStatus's contained cascade completes F (and F's epic if F was its last feature), with an auto_completed log entry. The uncommitted-work gate then refuses → withdrawCompletionClaim (packages/hench/src/agent/lifecycle/shared.ts ~line 1984) calls toolRexUpdateStatus(T, pending), which cascades only on completed/deferred (packages/hench/src/tools/rex.ts ~line 164). findParentResets / cascadeParentReset in rex (core/parent-reset.ts) exist but are invoked only from add paths. Result: F=completed, T=pending. On rerun T completes and F is already completed so nothing re-verifies F; the inconsistency persists until a human edits it.

SOLUTION
After resetting the task to pending, reopen completed ancestors bottom-up. rex already has the pure computation — findParentResets(items, parentId) walks from the parent chain and returns every consecutive completed ancestor — export it through packages/hench/src/prd/rex-gateway.ts (re-export only; update the gateway count in CLAUDE.md's gateway table) and apply the resets with store.updateItem(id, { status: 'pending', completedAt: undefined }, { preserveModifiedBy: true }) plus a status_reset log entry whose detail says the child's completion was withdrawn (do not reuse cascadeParentReset's 'new child added' wording). Best-effort, never thrown, same as the rest of withdrawCompletionClaim.

ACCEPTANCE CRITERIA
- Integration test: parent completed by the child's cascade is reset to pending when the child's completion is withdrawn; grandparent too when it was cascaded; an ancestor that was already completed before the run (not by this cascade) is also reopened, because it now has a pending descendant — document that this matches findParentResets semantics.
- Ancestor authorship is preserved (lastModifiedBy unchanged), consistent with #368.
- rex-gateway.test / domain-isolation policy still pass; changeset for @n-dx/hench (patch).
