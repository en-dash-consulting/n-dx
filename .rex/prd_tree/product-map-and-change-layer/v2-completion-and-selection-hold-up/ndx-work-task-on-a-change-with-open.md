---
id: "fa6420d7-b21c-47ea-ab8a-e5ef42471cc1"
level: "task"
title: "ndx work --task on a change with open tasks runs the whole change, then cannot complete it"
status: "pending"
priority: "high"
tags:
  - "v2-hardening"
  - "hench"
  - "rex"
source: "ndx-capture"
startedAt: "2026-10-15T04:57:15.779Z"
acceptanceCriteria:
  - "ndx work --task=<a change with open tasks> resolves to that change's next actionable task, respecting claims held by other worktrees, and claims that task, not the change (test)"
  - "--resolve with such a change reports the task the run would pick (test)"
  - "When every remaining task of the change is claimed elsewhere or blocked, --task is refused naming them (test)"
  - "A task-less change still runs as one unit (test)"
description: "Found 2026-10-14 (v2 migration-path page). On a copy of packages/rex/tests/fixtures/v2-tree, `ndx work --task=CH-1 --resolve` names the change itself (projected level \"epic\") although CH-1 has an open task. A run then works the whole change, and completion fails because the task is still open (completeV2Work throws ChangeCompletionError; updateCompletedTaskStatus reports it only as a warning).\n\nCode: rex core/change-selection.ts resolveWorkById returns a \"change\" unit for any change whose shape is not \"container\"; hench agent/planning/brief.ts selectTaskEntry (explicit-task branch) claims and briefs that unit.\n\nFix direction (Ryan, 2026-10-14): --task naming a change that has live, uncompleted tasks resolves to that change's next actionable task, using rex's v2 selection and skipping tasks another worktree has claimed, and claims that task, never the change. If every remaining task is claimed elsewhere or blocked, refuse naming them. A task-less change still runs as one unit. --resolve reports the task the run would pick. This covers b135e1f6 (a claim on the change while another worktree holds one of its tasks).\n\nOperator notes: keep hench's rex imports in src/prd/rex-gateway.ts. Do not touch packages/rex/src/migrations/ or the rex migrate command. Run the six static root policy tests before finishing: tests/e2e/architecture-policy, domain-isolation, shell-spawn-inventory-policy, wall-clock-inventory-policy, layout-literal-policy and obfuscated-code-policy. Add a changeset (patch, @n-dx/hench, and @n-dx/rex if rex changes).\n\nAttempt 1 (run 9775dbd1, 2026-10-14) committed 5cfd0a252 and the review repair a2c72495d. Its gate failed on one test only: tests/integration/cross-package-contracts.test.js 'hench gateway source exports match contract test list', because openChangeTasks is a new export of packages/hench/src/prd/rex-gateway.ts that is missing from GATEWAY_FUNCTIONS in that test. Attempt 2: keep the committed work, add the export to the contract list (and any contract assertion it needs), run the gate's affected suites and the six root policy tests, and verify the criteria."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-15T05:20:32.219Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
