---
id: "3dad263b-b819-486b-bc74-13eade3acd84"
level: "task"
title: "add_item stores a v2 modified amendment whose criteria delta does not fit the capability, which apply_change always refuses"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-17"
  - "rex"
  - "lane-rex-surface"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "add_item on a v2 tree with a modified amendment whose criteria.remove or criteria.replace names an id the target capability lacks is refused, naming the id, and writes nothing (test)"
  - "add_item on a v2 tree with a modified amendment whose criteria.add names an id the target already has is refused, naming the id (test)"
  - "The add_item check calls applyCriteriaDelta rather than a copy of the id checks (code reading)"
description: "Verdict: out-of-scope (pre-existing; surfaced by the review of b43e8502, which fixed the same gap in place_change only, scoped out add_item by decision).\n\nScenario: v2 PRD, capability A1.1 has criteria c1, c2. add_item {type: change, amends: [{target: \"A1.1\", delta: \"modified\", summary, criteria: {remove: [\"c7\"]}}]} (or replace of a missing id, or add of an existing id) succeeds and stores the amendment. apply_change then refuses \"criterion c7 to remove does not exist\". No MCP tool edits a v2 amendment and place_change refuses a second placement (\"already amends\"), so recovery is hand-editing the change folder or cancel-and-recreate.\n\nEvidence: packages/rex/src/cli/mcp-tools/add-item.ts passes args.amends through with zod shape validation only; no v2 rule checks criteria ids (grep of packages/rex/src for the apply messages finds only core/apply-amendments.ts). The shared check now exists: applyCriteriaDelta in core/apply-amendments.ts, used by applyModified and recordPlacement.\n\nReachable: rex MCP add_item on a v2 tree with amends carrying criteria.\n\nOptions:\n1. (Recommended) For each modified amendment of a capability target, run applyCriteriaDelta against the target's current criteria in the add_item v2 path and refuse with the problems, writing nothing. Cheap; reuses the single source of truth. Caveat: add_item amendments carry no base unless the caller sets one, so the check is against the spec at add time; apply still re-checks.\n2. Move the check into a v2 rule (checkV2Rules) so every writer gets it. Broader, but a rule finding on an open change would also fire after another change edits the capability's criteria, which may be noise; needs a decision."
lastModified: "2026-10-09T05:14:31.964Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
