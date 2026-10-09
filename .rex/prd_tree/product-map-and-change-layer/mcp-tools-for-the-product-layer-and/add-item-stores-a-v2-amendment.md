---
id: "bfb8ed54-bb47-4647-a5f0-8cc46b8c1700"
level: "task"
title: "add_item stores a v2 amendment carrying criteria that apply always refuses: a criteria delta on a constraint, or replace/remove on an added capability"
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
  - "add_item on a v2 tree with a modified amendment of a constraint carrying a non-empty criteria delta is refused and writes nothing (test)"
  - "add_item on a v2 tree with an added amendment whose criteria has replace or remove is refused and writes nothing (test)"
  - "add_item on a v2 tree with an added constraint amendment carrying criteria is refused (test)"
  - "The refusal messages match what apply_change reports for the same amendment (code reading)"
description: "Verdict: should-fix (found by the adversarial review of 3dad263b, which refused misfit criteria ids for modified capability amendments only, as decided).\n\nScenario: v2 PRD. add_item {type: change, amends: [{target: <constraint id>, delta: \"modified\", summary, criteria: {add: [{id: \"c1\", text}]}}]} succeeds; apply_change then always refuses \"a constraint has no criteria\" (core/apply-amendments.ts:360). Same for an added amendment with criteria.replace/remove (\"a new capability has no criteria to replace or remove\", :285) or an added constraint with criteria (:301). place_change refuses a constraint delta up front (core/change-place.ts:103-106); add_item does not. Recovery is the same as 3dad263b: hand-edit the change folder or cancel and recreate, since no tool edits a v2 amendment and place_change refuses a second placement.\n\nEvidence: refuseMisfitCriteria in packages/rex/src/core/change-add.ts skips any target that is not a capability and any delta other than modified.\n\nReachable: rex MCP add_item on a v2 tree.\n\nOptions:\n1. (Recommended) Extend refuseMisfitCriteria: refuse a criteria delta on a modified constraint target with placement's message, and refuse added amendments whose criteria apply would refuse. Cheap; mirrors apply. Risk: duplicates apply's message wording unless factored into a shared helper in apply-amendments.ts.\n2. Run the apply engine's per-amendment checks (APPLY functions) on a cloned tree at add time and refuse on its problems. Single source of truth for every refusal, but apply's base and ordering semantics at add time need care."
lastModified: "2026-10-09T05:41:45.398Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
