---
id: "79a057dc-3c25-4c2c-a411-3f3daddba51e"
level: "task"
title: "Design and implement Commands section UI with grouped command listing"
status: "completed"
priority: "high"
tags:
  - "web"
  - "ui"
  - "commands"
source: "smart-add"
startedAt: "2026-08-13T02:53:40.927Z"
completedAt: "2026-08-13T03:10:05.439Z"
endedAt: "2026-08-13T03:10:05.439Z"
acceptanceCriteria:
  - "Commands section appears as a sidebar navigation entry in the dashboard"
  - "All ndx CLI commands are listed and grouped by category (setup, analysis, planning, execution, config)"
  - "Each row shows the project-resolved CLI name (e.g. 'ndx plan' or 'myapp plan'), a short description, and an availability status indicator"
  - "The manifest is server-driven — adding a command to the manifest renders it in the UI without component changes"
  - "Section renders correctly in both light and dark themes at all density settings"
description: "Create a new Commands route/panel in the web dashboard listing all CLI commands grouped by functional category. Each entry shows the project-resolved CLI name (see Project-Aware CLI Identity epic), a one-line description, and a status indicator. The list is driven by a server-side command manifest so newly added commands appear without UI code changes."
---
