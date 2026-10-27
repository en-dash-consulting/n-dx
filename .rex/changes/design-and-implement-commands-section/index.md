---
id: "79a057dc-3c25-4c2c-a411-3f3daddba51e"
type: "change"
title: "Design and implement Commands section UI with grouped command listing"
slug: "design-and-implement-commands-section"
intent: "Create a new Commands route/panel in the web dashboard listing all CLI commands grouped by functional category. Each entry shows the project-resolved CLI name (see Project-Aware CLI Identity epic), a one-line description, and a status indicator. The list is driven by a server-side command manifest so newly added commands appear without UI code changes."
acceptanceCriteria:
  - "Commands section appears as a sidebar navigation entry in the dashboard"
  - "All ndx CLI commands are listed and grouped by category (setup, analysis, planning, execution, config)"
  - "Each row shows the project-resolved CLI name (e.g. 'ndx plan' or 'myapp plan'), a short description, and an availability status indicator"
  - "The manifest is server-driven — adding a command to the manifest renders it in the UI without component changes"
  - "Section renders correctly in both light and dark themes at all density settings"
touches:
  - "6f8afa48-7f03-4faa-82de-81af5c7db69e"
priority: "high"
tags:
  - "web"
  - "ui"
  - "commands"
source: "smart-add"
---
