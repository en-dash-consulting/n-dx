---
id: "1a63946a-eb94-46ec-ba08-3aee7bb7a869"
level: "feature"
title: "Fresh v2 projects: dashboard add, progress and labels"
status: "pending"
priority: "high"
tags:
  - "0.10.0"
  - "v2"
  - "fresh-project"
  - "dashboard"
  - "web"
  - "rex"
source: "ndx-capture"
acceptanceCriteria: []
description: "A coworker started a new project on main's v2 init and found the dashboard reads it the v1 way. Smart Add makes a bare change; a change cannot get tasks from the dashboard; and the progress numbers and labels count changes as epics. Reproduced on 2026-10-22 on main 0a7c21477 with a probe project. Data is not lost: edits to title, description, criteria and tags persist, and survive completion. 0.10.0 ships v2 init to every new project, so these are what a new user meets first."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-22T17:14:30.564Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Dashboard progress counts a v2 change as an epic: a task-less change shows 0/0 and is left out of the totals](./dashboard-progress-counts-a-v2-change.md) | pending |
| [Dashboard proposal accept on v2 skips the Inbox and drops proposed subtasks](./dashboard-proposal-accept-on-v2-skips.md) | pending |
| [On a v2 project, Smart Add makes a bare change while the panel still promises LLM proposals](./on-a-v2-project-smart-add-makes-a-bare.md) | pending |
| [The dashboard cannot add a task under a v2 change](./the-dashboard-cannot-add-a-task-under.md) | pending |
| [The Work page's Up Next card shows an empty id slot for an Inbox change](./the-work-page-s-up-next-card-shows-an.md) | pending |
