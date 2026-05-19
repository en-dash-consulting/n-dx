---
id: "f2b6fb47-5878-4556-abdc-8232c2ce3b33"
level: "task"
title: "Exclude completed tasks from hench task selection across all selection paths"
status: "completed"
priority: "high"
tags:
  - "hench"
  - "selection"
  - "prd-status"
source: "smart-add"
startedAt: "2026-05-12T14:03:38.034Z"
completedAt: "2026-05-12T14:17:46.350Z"
endedAt: "2026-05-12T14:17:46.350Z"
resolutionType: "code-change"
resolutionDetail: "Created shared predicate isCompletedTask() and added 22 integration tests validating completed task exclusion across all selection paths (auto, --task, --epic-by-epic, loop). All selection paths consistently filter completed tasks at the selection layer."
acceptanceCriteria:
  - "A single shared predicate filters completed tasks out of all hench selection paths"
  - "Explicit --task=<id> targeting a completed task prints a clear message and exits without working the task"
  - "Auto/loop/epic-by-epic modes never return completed tasks as the next task"
  - "Integration test asserts each selection mode skips completed tasks"
description: "Audit every task-selection path in hench (auto, --task, --epic-by-epic, self-heal, loop) and ensure completed tasks are filtered out at the selection layer rather than relying on downstream checks. Add a single shared predicate that all selectors use so completion exclusion is enforced uniformly. Surface a clear console message when a requested task is skipped because it is already complete."
---
