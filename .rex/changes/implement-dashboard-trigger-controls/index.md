---
id: "5320dc1b-d8d6-483c-8bad-d9b4c6310d0f"
type: "change"
title: "Implement dashboard trigger controls for CLI commands lacking UI representation"
slug: "implement-dashboard-trigger-controls"
intent: "Based on the audit, add action buttons, panels, or workflow controls for high-impact CLI commands that have no dashboard equivalent. At minimum: ndx analyze (re-scan codebase), ndx plan (analyze + propose PRD changes), ndx sync (push/pull PRD to remote adapter), ndx export (export static dashboard), and ndx self-heal (iterative improvement loop). Each control must invoke the underlying CLI operation via the web server's MCP or REST surface, display real-time status or streaming output, and surface errors clearly."
acceptanceCriteria:
  - "All commands ranked high-priority in the gap audit have a corresponding dashboard trigger"
  - "Each trigger invokes the equivalent CLI operation and shows real-time progress or log output"
  - "Long-running commands (analyze, plan, self-heal) display a spinner or log stream and a completion/failure notification"
  - "Destructive or irreversible operations (e.g., plan --accept, self-heal) require a confirmation step before executing"
  - "No high-priority gap command remains inaccessible from the dashboard after implementation"
amends: [{"target":"749cecdc-4d4c-4468-ae08-5e28e117996c","delta":"modified","summary":"Implement dashboard trigger controls for CLI commands lacking UI representation","base":"c923fc1654c48a8d47336edf1098c752540773b167535058905933bf8d28682e"}]
priority: "high"
tags:
  - "web"
  - "cli"
  - "ui"
source: "smart-add"
---
