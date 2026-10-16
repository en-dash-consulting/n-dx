---
id: "e68f98e9-8c5e-4700-804d-6d271cf3b08f"
level: "task"
title: "rex health errors forever on a held change whose v1 item completed between plan and apply"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-23"
  - "lane-migration"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A v1 item completed after the plan's cutAt but before apply, held in the Inbox by migrate --apply, makes rex health exit 0 with change-placed-at-close as a warning (test through buildV2Tree + checkV2Rules)"
  - "A held change completed in v2 after apply still reports change-placed-at-close as an error (test)"
description: "Verdict: should-fix (medium). Found by the adversarial review of 266170f3 (change-placed-at-close downgrade, S2-Q2).\n\nFailure scenario: run `ndx migrate --plan` (cutAt T0), keep working in v1 (ndx work completes a task, completedAt T1 > T0), then `ndx migrate --apply` against the newer tree (supported: apply is re-runnable against a newer tree). The completed item is held (needsPlacement, appliedAt = its completedAt T1). The cut change is applied at plan.header.cutAt = T0 (packages/rex/src/migrations/v1-to-v2/apply.ts cutChange). packages/rex/src/schema/v2-rules.ts changePlacedAtClose compares closedAt T1 with migrationCutAt T0 and reports an error. rex change place refuses a closed change, so the error can never be cleared: rex health exits 1 on the migrated tree, the original defect again for this subset.\n\nReachability: any real migration where v1 work completes between plan and apply. Within v2 a held change cannot be completed (awaitsPlacement holds it open), so in practice the \"after the cut\" error branch is reached mostly by this case.\n\nOptions:\n1. (Recommended) Treat a held change as migrated v1 work by what apply stamped, not by the plan cut: e.g. compare against the cut change's own write time, or have the rule treat any held change whose id appears in the cut's v1 id set as migrated. Needs a decision, since S2-Q2 says \"completed at or before the migration's cut\".\n2. Make apply stamp the cut at apply time (max of cutAt and the newest completedAt among held changes). Cheap, but changes the cut id seed / cut time semantics that 54f68a0f is also touching.\n3. Leave as error and document it; user must re-plan before apply. Cheapest, keeps the defect.\n\nDecision needed from Ryan: whether \"the cut\" in S2-Q2 means the plan's cutAt or the moment apply ran."
lastModified: "2026-10-16T02:50:29.692Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
