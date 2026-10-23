---
id: "1a63946a-eb94-46ec-ba08-3aee7bb7a869"
type: "change"
title: "Fresh v2 projects: dashboard add, progress and labels"
slug: "fresh-v2-projects-dashboard-add"
intent: "A coworker started a new project on main's v2 init and found the dashboard reads it the v1 way. Smart Add makes a bare change; a change cannot get tasks from the dashboard; and the progress numbers and labels count changes as epics. Reproduced on 2026-10-22 on main 0a7c21477 with a probe project. Data is not lost: edits to title, description, criteria and tags persist, and survive completion. 0.10.0 ships v2 init to every new project, so these are what a new user meets first."
plannedRelease: "0.10.0"
priority: "high"
tags:
  - "0.10.0"
  - "v2"
  - "fresh-project"
  - "dashboard"
  - "web"
  - "rex"
source: "ndx-capture"
---
