---
id: "b0467938-b793-41ee-923d-cfd5c57322df"
level: "task"
title: "Select placed changes and tasks, including task-less changes"
status: "pending"
priority: "high"
tags:
  - "pr-16"
  - "lane-rex-domain"
  - "rex"
source: "roadmap"
acceptanceCriteria:
  - "A task-less change is selectable (test)"
  - "needsPlacement items are skipped by autonomous selection and runnable by id (test)"
  - "Ordering follows priority then plannedRelease (test)"
description: "get_next_task picks placed changes and tasks; a change with no tasks is itself the unit of work. Order by priority, then nearest plannedRelease, then dependency order. needsPlacement blocks autonomous selection only; ndx work --task still runs it. ready is informational; --ready-only and --mine (by assignee) are opt-in."
lastModified: "2026-10-06T04:17:53.819Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
