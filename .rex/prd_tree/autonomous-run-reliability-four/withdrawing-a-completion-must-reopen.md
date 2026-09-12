---
id: "ecb154ec-3916-4cd6-afd3-1cb15200ac3a"
level: "task"
title: "Withdrawing a completion must reopen the ancestors the agent's own cascade already closed"
status: "completed"
priority: "high"
startedAt: "2026-09-12T04:31:50.726Z"
completedAt: "2026-09-12T04:47:30.792Z"
endedAt: "2026-09-12T04:47:30.792Z"
acceptanceCriteria: []
description: "Follow-up to PR #370 review (finding 6). Severity: high — leaves the PRD in the parent-child inconsistency state that rex validate warns about, with no path that repairs it.\n\nFAILURE SCENARIO\nFeature F (pending) has one remaining task T. The agent calls rex_update_status(T, completed) → toolRexUpdateStatus's contained cascade completes F (and F's epic if F was its last feature), with an auto_completed log entry. The uncommitted-work gate then refuses → withdrawCompletionClaim (packages/hench/src/agent/lifecycle/shared.ts ~line 1984) calls toolRexUpdateStatus(T, pending), which cascades only on completed/deferred (packages/hench/src/tools/rex.ts ~line 164). findParentResets / cascadeParentReset in rex (core/parent-reset.ts) exist but are invoked only from add paths. Result: F=completed, T=pending. On rerun T completes and F is already completed so nothing re-verifies F; the inconsistency persists until a human edits it.\n\nSOLUTION\nAfter resetting the task to pending, reopen completed ancestors bottom-up. rex already has the pure computation — findParentResets(items, parentId) walks from the parent chain and returns every consecutive completed ancestor — export it through packages/hench/src/prd/rex-gateway.ts (re-export only; update the gateway count in CLAUDE.md's gateway table) and apply the resets with store.updateItem(id, { status: 'pending', completedAt: undefined }, { preserveModifiedBy: true }) plus a status_reset log entry whose detail says the child's completion was withdrawn (do not reuse cascadeParentReset's 'new child added' wording). Best-effort, never thrown, same as the rest of withdrawCompletionClaim.\n\nACCEPTANCE CRITERIA\n- Integration test: parent completed by the child's cascade is reset to pending when the child's completion is withdrawn; grandparent too when it was cascaded; an ancestor that was already completed before the run (not by this cascade) is also reopened, because it now has a pending descendant — document that this matches findParentResets semantics.\n- Ancestor authorship is preserved (lastModifiedBy unchanged), consistent with #368.\n- rex-gateway.test / domain-isolation policy still pass; changeset for @n-dx/hench (patch)."
lastModified: "2026-09-12T04:47:31.054Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
