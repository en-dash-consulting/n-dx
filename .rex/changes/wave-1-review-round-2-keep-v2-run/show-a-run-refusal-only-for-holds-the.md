---
id: "2a29f14c-7dd2-437b-bdca-920763d43ed3"
type: "task"
title: "Show a run refusal only for holds the user can act on"
slug: "show-a-run-refusal-only-for-holds-the"
description: "PR #1002 review comment https://github.com/en-dash-consulting/n-dx/pull/1002#discussion_r4558509124. markRunnableUnits sets executionRefusal on every ineligible item and task-detail.ts renders it under Status with no styling, so every v1 epic and feature, every change with tasks and every task of an applied change shows an error-like line."
acceptanceCriteria:
  - "Task detail shows a refusal reason only for an actionable hold: an Inbox change awaiting placement, a closed change, or a subtask whose parent task runs it."
  - "v1 epics and features, changes with tasks and tasks of applied changes show no refusal line."
  - "Any refusal line that is shown has styling consistent with the status block."
priority: "high"
source: "ndx-capture"
---
