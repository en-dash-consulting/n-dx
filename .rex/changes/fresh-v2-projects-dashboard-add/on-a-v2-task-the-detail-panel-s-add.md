---
id: "8f19e94a-452a-42f9-b912-f6eb96c5ace1"
type: "task"
title: "On a v2 task, the detail panel's Add Subtask form offers a priority the server silently drops"
slug: "on-a-v2-task-the-detail-panel-s-add"
description: "Scenario: v2 project, open a task's detail panel, \"+ Add Subtask\", expand extra fields, pick priority High, submit. POST /api/rex/items adds the subtask (packages/web/src/server/routes-rex/items.ts addV2Child) but passes priority only when type is task, because a v2 subtask carries no priority (rex core/change-add.ts UNCARRIED). The subtask is created with no priority and the user is not told. Reachable from the dashboard on every v2 task. Verdict should-fix (low): no data corruption, but user input is dropped silently. Options: (a) hide the priority select in AddChildForm (packages/web/src/viewer/components/prd-tree/task-detail.ts) when the child is a v2 subtask — needs the layout in the viewer (dashboard response already carries layout v1|v2); cheap, recommended. (b) refuse priority on a v2 subtask with 400 naming why — honest but makes the form fail on an innocent field."
acceptanceCriteria:
  - "On a v2 project the Add Subtask form in a task's detail panel shows no priority control, or a subtask POST carrying priority is refused with a reason instead of dropped"
  - "On a v1 project the Add Subtask form still offers priority and the subtask keeps it"
  - "A viewer or route test covers the v2 subtask case"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
