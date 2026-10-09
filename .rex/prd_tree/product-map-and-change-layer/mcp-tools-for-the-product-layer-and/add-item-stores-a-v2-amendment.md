---
id: "bfb8ed54-bb47-4647-a5f0-8cc46b8c1700"
level: "task"
title: "add_item stores a v2 amendment carrying criteria that apply always refuses: a criteria delta on a constraint, or replace/remove on an added capability"
status: "in_progress"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-17"
  - "rex"
  - "lane-rex-surface"
  - "pr-review"
source: "ndx-adversarial-review"
startedAt: "2026-10-09T06:12:32.690Z"
acceptanceCriteria:
  - "add_item on a v2 tree refuses a change whose amends apply_change would refuse, by running the pure apply engine (core/apply-amendments.ts) on a copy of the tree with the new change in it; the message is apply's own and nothing is written (test)"
  - "place_change with relation amends refuses the same way, checking the amendment it would record (test)"
  - "Covered cases include a criteria delta on a constraint, replace or remove on a capability the same change adds, criteria on a constraint the same change adds, misfit capability-criteria ids, and two amendments of one capability applied in order (tests)"
  - "An amendment that apply_change accepts is still accepted by add_item and place_change, and the dry run never stamps or mutates the tree it was given (test)"
  - "The hand-written per-case checks (refuseMisfitCriteria, recordPlacement's criteria-id and constraint checks) are removed or reduced to the dry run, so apply is the single source of truth (code reading)"
  - "v1 trees and tool input shapes are unchanged; the tools/list snapshot is unchanged"
run: {"contextNotes":"Rebuild before finishing: after your last edit under packages/<pkg>/src, run `pnpm --filter @n-dx/<pkg> build`, and run it again if the adversarial review repairs any file under packages/<pkg>/src. Hench runs its affected test gate right after the review without rebuilding, and the gate refuses a stale dist/ (runs d3e891fe and 699cd138 failed this way; tracked as a hench bug under d0c26ff0)."}
description: "Verdict: should-fix (found by the adversarial review of 3dad263b, which refused misfit criteria ids for modified capability amendments only, as decided).\n\nScenario: v2 PRD. add_item {type: change, amends: [{target: <constraint id>, delta: \"modified\", summary, criteria: {add: [{id: \"c1\", text}]}}]} succeeds; apply_change then always refuses \"a constraint has no criteria\" (core/apply-amendments.ts:360). Same for an added amendment with criteria.replace/remove (\"a new capability has no criteria to replace or remove\", :285) or an added constraint with criteria (:301). place_change refuses a constraint delta up front (core/change-place.ts:103-106); add_item does not. Recovery is the same as 3dad263b: hand-edit the change folder or cancel and recreate, since no tool edits a v2 amendment and place_change refuses a second placement.\n\nEvidence: refuseMisfitCriteria in packages/rex/src/core/change-add.ts skips any target that is not a capability and any delta other than modified.\n\nReachable: rex MCP add_item on a v2 tree.\n\nOptions:\n1. (Recommended) Extend refuseMisfitCriteria: refuse a criteria delta on a modified constraint target with placement's message, and refuse added amendments whose criteria apply would refuse. Cheap; mirrors apply. Risk: duplicates apply's message wording unless factored into a shared helper in apply-amendments.ts.\n2. Run the apply engine's per-amendment checks (APPLY functions) on a cloned tree at add time and refuse on its problems. Single source of truth for every refusal, but apply's base and ordering semantics at add time need care.\n\nDecided 2026-10-09 (Ryan): close the whole class in PR 17, not case by case. This is the third capture in this family (b43e8502 for place_change ids, 3dad263b for add_item ids, now this), each copying one apply rule into a write tool. Instead, add_item (v2) and place_change (with relation amends) dry-run the pure apply engine on a structuredClone of the tree that already contains the new or placed change, and refuse with apply's own error when apply would refuse. Apply's freshness check (base vs current spec) must not make a freshly placed amendment fail; use the same base the tool records. Keep apply-only effects (appliedAt, metAt stamps) out of the stored tree: the dry run's result is discarded.\n\nLane: core/change-add.ts, core/change-place.ts, core/apply-amendments.ts (only if a dry-run entry point is needed), cli/mcp-tools/add-item.ts and place-change.ts, tests."
lastModified: "2026-10-09T06:12:32.947Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
