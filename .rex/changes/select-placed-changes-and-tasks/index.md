---
id: "b0467938-b793-41ee-923d-cfd5c57322df"
type: "change"
title: "Select placed changes and tasks, including task-less changes"
slug: "select-placed-changes-and-tasks"
intent: "get_next_task picks placed changes and tasks; a change with no tasks is itself the unit of work. Order by priority, then nearest plannedRelease, then dependency order. needsPlacement blocks autonomous selection only; ndx work --task still runs it. ready is informational; --ready-only and --mine (by assignee) are opt-in.\n\nThe module landed here; wiring it into get_next_task, update_task_status and hench is roadmap PR 34 (A2) and stack B."
acceptanceCriteria:
  - "A task-less change is selectable (test)"
  - "needsPlacement items are skipped by autonomous selection and runnable by id (test)"
  - "Ordering follows priority then plannedRelease (test)"
touches:
  - "d3bfe8a4-c3d5-4aa4-893b-36fc58647dca"
priority: "high"
tags:
  - "pr-16"
  - "lane-rex-domain"
  - "rex"
source: "roadmap"
---
