---
id: "6251db73-619f-4c23-b31a-f4eafa085bed"
level: "task"
title: "Bulk status PATCH completing a v2 change under rex.applyOn review reports ok with no reason it was left unapplied"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "pr-36"
  - "lane-web"
  - "review-2026-10-13"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "Under rex.applyOn review, a bulk completing PATCH of a change returns that id's result with applied:false and completeV2Work's reason (route test in routes-rex-v2-items that fails today)"
  - "A bulk completion that applies keeps its result entry as {id, ok:true}"
  - "Changeset lists the new optional bulk result fields; v1 unchanged"
description: "Out-of-scope finding from the adversarial review of task ecc9c0bd (commit 9fa6c4cbb), pre-existing in the bulk path. Verdict: out-of-scope (pre-existing; real, reachable).\n\nScenario: .n-dx.json {rex:{applyOn:\"review\"}}; PATCH /api/rex/items/bulk {ids:[<change>], updates:{status:\"completed\"}} → results [{id, ok:true}] with no reason. The single PATCH now returns {ok,applied,reason} (items.ts:229), but the bulk loop (items.ts:~548) discards completeV2Work's return, so a bulk caller cannot tell why the change was left unapplied.\n\nReachable: dashboard bulk status action on a v2 project.\n\nFix options: (1, recommended) keep completeV2Work's result in the bulk loop and add `applied`/`reason` to that id's result entry when reason is set; ~5 lines + a route test; add soft-freeze changeset line. (2) leave it; the Changes view's awaiting-apply stage already shows the state, only the why is missing."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-13T18:52:47.779Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
