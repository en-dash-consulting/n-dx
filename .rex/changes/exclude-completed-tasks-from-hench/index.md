---
id: "f2b6fb47-5878-4556-abdc-8232c2ce3b33"
type: "change"
title: "Exclude completed tasks from hench task selection across all selection paths"
slug: "exclude-completed-tasks-from-hench"
intent: "Audit every task-selection path in hench (auto, --task, --epic-by-epic, self-heal, loop) and ensure completed tasks are filtered out at the selection layer rather than relying on downstream checks. Add a single shared predicate that all selectors use so completion exclusion is enforced uniformly. Surface a clear console message when a requested task is skipped because it is already complete."
acceptanceCriteria:
  - "A single shared predicate filters completed tasks out of all hench selection paths"
  - "Explicit --task=<id> targeting a completed task prints a clear message and exits without working the task"
  - "Auto/loop/epic-by-epic modes never return completed tasks as the next task"
  - "Integration test asserts each selection mode skips completed tasks"
touches:
  - "03266251-06ef-4864-960a-0cb02986ff1d"
priority: "high"
tags:
  - "hench"
  - "selection"
  - "prd-status"
source: "smart-add"
---
