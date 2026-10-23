---
id: "4fc2aacd-651b-4499-8555-2a6f2c8007ba"
type: "change"
title: "Filter hench task selection to self-heal tagged items when running in self-heal mode"
slug: "filter-hench-task-selection-to-self"
intent: "Pass a tag filter from ndx self-heal into the hench run invocation so that rex get_next_task only surfaces self-heal tagged items. Prevents the agent from accidentally picking up and completing unrelated PRD tasks during a self-heal session."
acceptanceCriteria:
  - "ndx self-heal passes a 'self-heal' tag constraint to hench/rex task selection"
  - "rex get_next_task returns only tasks tagged 'self-heal' when the filter is active"
  - "Non-self-heal tasks are never started or modified during a self-heal run"
  - "Tag filter is reflected in the hench run brief and run logs"
touches:
  - "ae28134a-cb7d-4427-87f0-55094e3500d0"
priority: "critical"
tags:
  - "self-heal"
  - "hench"
  - "rex"
source: "smart-add"
---
