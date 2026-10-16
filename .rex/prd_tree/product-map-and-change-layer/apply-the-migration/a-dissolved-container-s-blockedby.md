---
id: "b77fb78f-ba50-4307-8af2-7131cee0d193"
level: "task"
title: "A dissolved container's blockedBy rewrite at migrate --apply is invisible to a reviewer: neither the plan nor the dry run shows it"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "pr-23"
  - "lane-migration"
  - "rex"
  - "review-2026-10-12"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "rex migrate --apply --dry-run lists each node whose blockedBy was repointed or dropped because of a dissolved container, with the old and new refs (test)"
  - "The cut change's body names the repointed blockedBy refs after apply (test)"
description: "Found by the adversarial review of fde93c35. Verdict: should-fix.\n\nFailure: buildV2Tree (packages/rex/src/migrations/v1-to-v2/apply.ts, repointDissolvedBlockers) rewrites every blockedBy ref to a dissolved release or review epic. It fans the ref out to the epic's open children, or drops it when the epic was completed in v1 or has no open child left. Neither the plan file (migration-plan-data) nor `rex migrate --apply --dry-run` (rehearseV1ToV2 / tallyV1ToV2) reports these rewrites. A v1 item blockedBy a 30-feature release epic silently gains 30 blockers, or loses its blocker, and the reviewer approving the plan cannot see either change. The task that added the rewrite recommended recording it in the plan's data. That part was not done.\n\nReachability: any v1 tree with a blockedBy ref to a release or review epic, on `ndx migrate --apply`.\n\nOptions:\n(a) Return the rewrites from buildV2Tree (id → {from, to}) and print them in the dry run and in the cut change's body. Cheap, and the plan stays unchanged.\n(b) Compute them at plan time and store them in the plan data. The reviewer sees them before approval, but they can go stale against a newer tree, since apply is re-runnable.\nRecommendation: (a), plus (b) as a preview if plan review needs it."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T09:29:34.218Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
