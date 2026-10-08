---
id: "318c0195-d21c-40aa-8c2c-473be98fa806"
level: "task"
title: "Migration plan emits two different criteria sets for a capability, so reviewedHash can mismatch the migrated spec"
status: "completed"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "pr-13"
  - "lane-migration"
  - "rex"
blockedBy:
  - "ab7b00bb-b362-44d9-917f-23fb0f4e85dd"
source: "ndx-adversarial-review"
startedAt: "2026-10-08T20:57:20.663Z"
completedAt: "2026-10-08T21:01:36.508Z"
endedAt: "2026-10-08T21:01:36.508Z"
acceptanceCriteria:
  - "For a capability entry, the plan's criteria and the criteria hashed into reviewedHash come from one source (test)"
  - "A capability listed as reviewed, migrated with the plan's spec, satisfies reviewedHash === specHash(nodeSpec(node)) (test)"
description: "Verdict: should-fix (from adversarial review of 4d1c098c). Severity low: no caller yet.\n\n`buildPlanData` (packages/rex/src/core/migration-plan-data.ts) emits `criteria` for every item from raw `acceptanceCriteria`, numbered c1..cn. That includes capability items. It also stamps `reviewedHash = specHash(draft)` from `draftCapabilitySpecs` (core/capability-spec.ts), whose criteria are EARS-rewritten, deduplicated, drawn from applied history, and numbered c1..cn. The two lists share ids but not text.\n\nTrigger: take a capability feature with acceptanceCriteria [\"Add X\"] and list it in `reviewed`. The draft's c1 is the rewritten text, while plan data's c1 is \"Add X\". An applier wired in 27e4f378 that writes `data.criteria` onto the capability produces specHash(node) ≠ reviewedHash, so a reviewed node reads unreviewed. The plan's statement and criteria for a capability then have no single source.\n\nReachable only once `ndx migrate --plan` and apply are wired (27e4f378).\n\nOptions:\n(a) Recommended: buildPlanData omits `criteria` for capability entries and documents the draft as the capability's spec source. Cheap; one branch plus a test.\n(b) Put the draft's statement and criteria into ItemPlanData for capabilities, so the plan file holds the hashed spec. Larger output, single source.\n\nBefore finishing, run `pnpm --filter @n-dx/rex build`: the affected test gate refuses a stale rex dist/ (run 699cd138 failed only on that)."
lastModified: "2026-10-08T21:01:36.767Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
