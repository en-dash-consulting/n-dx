---
id: "4fc2aacd-651b-4499-8555-2a6f2c8007ba"
level: "task"
title: "Filter hench task selection to self-heal tagged items when running in self-heal mode"
status: "completed"
priority: "critical"
tags:
  - "self-heal"
  - "hench"
  - "rex"
source: "smart-add"
startedAt: "2026-04-24T14:36:54.749Z"
completedAt: "2026-04-24T15:03:15.777Z"
resolutionType: "code-change"
resolutionDetail: "Added tags filter to PrioritizationOptions, findNextTask, findActionableTasks; threaded through hench run via --tags flag; ndx self-heal now passes --tags=self-heal"
acceptanceCriteria:
  - "ndx self-heal passes a 'self-heal' tag constraint to hench/rex task selection"
  - "rex get_next_task returns only tasks tagged 'self-heal' when the filter is active"
  - "Non-self-heal tasks are never started or modified during a self-heal run"
  - "Tag filter is reflected in the hench run brief and run logs"
description: "Pass a tag filter from ndx self-heal into the hench run invocation so that rex get_next_task only surfaces self-heal tagged items. Prevents the agent from accidentally picking up and completing unrelated PRD tasks during a self-heal session."
---

# Filter hench task selection to self-heal tagged items when running in self-heal mode

🔴 [completed]

## Summary

Pass a tag filter from ndx self-heal into the hench run invocation so that rex get_next_task only surfaces self-heal tagged items. Prevents the agent from accidentally picking up and completing unrelated PRD tasks during a self-heal session.

## Info

- **Status:** completed
- **Priority:** critical
- **Tags:** self-heal, hench, rex
- **Level:** task
- **Started:** 2026-04-24T14:36:54.749Z
- **Completed:** 2026-04-24T15:03:15.777Z
- **Duration:** 26m
