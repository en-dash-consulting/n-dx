---
id: "48598986-a990-46cc-8f40-6b93dd85a880"
level: "task"
title: "Applying a migration plan does not refuse one whose model pass is marked incomplete"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-23"
  - "rex"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "Applying a plan with any pass marked incomplete fails, naming the pass and its error, and writes nothing (test)"
  - "migrate --plan reports an incomplete plan as incomplete and exits non-zero (test)"
description: "Since bb2a3276, runPlanPipeline returns normally when a seam fails, with header.passes[i].incomplete = { error } (packages/rex/src/migrations/plan-file.ts PassRecord). Entries after the failure lack the pass's merge (e.g. no capability statement) and later passes did not run. The apply task (11c88bce) has no criterion to refuse such a plan, and no predicate is exported, so an apply written from the current criteria would migrate capabilities with missing specs.\n\nReachable when apply (PR 23) and a model pass both land. Verdict: should-fix.\n\nOptions:\n1. (Recommended) Export isPlanComplete(plan) from plan-file.ts; apply and migrate --plan both use it — apply refuses naming the pass and error, plan reports the plan as incomplete and exits non-zero. Cost: small. Risk: none.\n2. Add the refusal criterion to 11c88bce only. Cost: smaller; risk: the --plan command can still report success."
lastModified: "2026-10-08T23:21:41.840Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
