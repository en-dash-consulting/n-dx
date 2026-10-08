---
id: "d71f7e48-5e86-4189-b284-120cc2fcf417"
level: "task"
title: "Adapt the apply engine and product-edit handler to PR 30's schema and rules"
status: "pending"
priority: "critical"
acceptanceCriteria: []
description: "Run first after the PR 30 merge (merge commit a5d52f82d), which left this branch red. Goal: rex typechecks and every rex test passes, with no behaviour beyond what PR 30 requires. Decided 2026-10-07 (Ryan, option B).\n\n- core/product-edit.ts: PR 30 removed the CLOSED_STATUSES export this file imported, and its isOpenChange no longer narrows a node to a change. Use the shared isOpenChange and isAppliedChange from schema/v2-rules.ts (open = not applied and not cancelled or deleted; a completed but unapplied change is open). For cancelOpen (cancelling a withdrawn draft's tasks and subtasks), keep a local set of terminal statuses (completed, cancelled, deleted) for those items. Narrow to a change with a local type guard or check, not by re-exporting anything from v2-rules. Fixes 4 type errors and 5 failing product-edit tests.\n- core/apply-amendments.ts: PR 30 retired appliedIn. Apply stamps appliedAt (an ISO timestamp the caller passes) instead of appliedIn, drops the commit option, and refuses an already applied change with isAppliedChange. Update the module comment and the tests, including the touches-only test that expected appliedIn.\nDo not start 8cfdb939's other work here (appliedAmendsHash, base refusal, running the rules on apply's output, constraints, clearing needsPlacement). Patch changeset for @n-dx/rex."
lastModified: "2026-10-08T03:21:55.081Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
