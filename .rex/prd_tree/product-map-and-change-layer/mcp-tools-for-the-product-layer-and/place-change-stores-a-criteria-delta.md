---
id: "b43e8502-f398-4622-8f30-376c11bd72d8"
level: "task"
title: "place_change stores a criteria delta whose ids do not fit the capability, which apply_change always refuses"
status: "completed"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-17"
  - "rex"
  - "lane-rex-surface"
  - "pr-review"
source: "ndx-adversarial-review"
startedAt: "2026-10-09T05:07:12.820Z"
completedAt: "2026-10-09T05:22:33.663Z"
endedAt: "2026-10-09T05:22:33.663Z"
resolutionType: "code-change"
resolutionDetail: "Extracted applyCriteriaDelta (core/apply-amendments.ts), used by applyModified and recordPlacement; place_change now refuses misfit criteria ids before writing."
acceptanceCriteria:
  - "place_change with criteria.remove or criteria.replace naming an id the target capability does not have is refused, naming the id, and writes nothing (test)"
  - "place_change with criteria.add naming an id the target already has is refused, naming the id (test)"
  - "recordPlacement and apply's modified delta use one shared criteria-delta check, so their verdicts cannot drift (test or code reading)"
run: {"contextNotes":"Rebuild before finishing: after your last edit under packages/<pkg>/src, run `pnpm --filter @n-dx/<pkg> build`, and run it again if the adversarial review repairs any file under packages/<pkg>/src. Hench runs its affected test gate right after the review without rebuilding, and the gate refuses a stale dist/ (runs d3e891fe and 699cd138 failed this way; tracked as a hench bug under d0c26ff0)."}
description: "Found by the adversarial review of task 383f9b5f. Verdict: should-fix.\n\nScenario: capability A1.1 has criteria c1, c2. place_change {id, target: \"A1.1\", relation: \"amends\", criteria: {remove: [\"c7\"]}} (or replace of a missing id, or add of an existing id like c1) succeeds and stores the amendment. apply_change then refuses with \"criterion c7 to remove does not exist\". The change is stuck: place_change refuses a second placement (\"already amends\"), and no MCP tool edits a v2 amendment. Recovery is hand-editing the change folder or cancelling and recreating the change.\n\nEvidence: packages/rex/src/core/change-place.ts recordPlacement validates relation and (since the review) refuses criteria on a constraint, but not criteria ids; the id checks live only in applyModified (packages/rex/src/core/apply-amendments.ts). Placement pins base = specHash(nodeSpec(target)), so the spec seen at placement is the spec apply checks against (absent force): validating ids at placement is authoritative.\n\nReachable: rex MCP place_change, any caller passing criteria.\n\nOptions:\n1. (Recommended) Extract the criteria-delta check from applyModified into a shared pure function (criteria list + delta → problems) and call it from recordPlacement and applyModified. Small; one source of truth.\n2. Duplicate the three id checks in recordPlacement. Cheaper now, drifts later.\nSame gap exists for add_item's amends on v2; option 1 lets add_item use the shared check too (decide whether in scope).\n\nDecided 2026-10-09 (Ryan): fix in PR 17 before re-requesting review on #612. Validate capability-criteria ids at placement with the same check apply's modified delta uses, so place_change refuses what apply_change would refuse and writes nothing. No tool shape change. Lane: core/change-place.ts, core/apply-amendments.ts (extract the shared check), tests."
lastModified: "2026-10-09T05:22:34.721Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
