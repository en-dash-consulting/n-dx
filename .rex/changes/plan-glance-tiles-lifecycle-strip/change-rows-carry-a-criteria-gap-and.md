---
id: "4c55d13a-5799-4158-bbe2-bcaf30ddaede"
type: "task"
title: "Change rows carry a criteria gap and an open-blocker count"
slug: "change-rows-carry-a-criteria-gap-and"
description: "ChangeRowWire has stage, taskCount and completedTaskCount but nothing for the gap chips. Add `criteriaGap` (true when the change has no acceptance criteria, or an open task under it has none) and `openBlockers` (blockedBy ids on the change or its open tasks that are not completed). A change with no tasks but with its own criteria has no gap."
acceptanceCriteria:
  - "ChangeRowWire has criteriaGap and openBlockers, typed in the viewer as well"
  - "A task-less change with acceptance criteria reports criteriaGap false"
  - "A change whose open task has no acceptance criteria reports criteriaGap true"
  - "A completed blocker does not count toward openBlockers"
priority: "medium"
source: "ndx-capture"
---
