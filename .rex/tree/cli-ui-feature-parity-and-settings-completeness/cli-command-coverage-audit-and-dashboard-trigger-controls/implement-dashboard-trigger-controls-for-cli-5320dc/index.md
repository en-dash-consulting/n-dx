---
id: "5320dc1b-d8d6-483c-8bad-d9b4c6310d0f"
level: "task"
title: "Implement dashboard trigger controls for CLI commands lacking UI representation"
status: "completed"
priority: "high"
tags:
  - "web"
  - "cli"
  - "ui"
source: "smart-add"
startedAt: "2026-04-19T03:39:23.399Z"
completedAt: "2026-04-19T03:56:04.549Z"
resolutionType: "code-change"
resolutionDetail: "Added POST /api/commands/* routes and dashboard UI components for sv-analyze, sync, recommend, export, and self-heal commands. New Commands view, inline triggers in Overview/Suggestions, SyncPanel in Notion config."
acceptanceCriteria:
  - "All commands ranked high-priority in the gap audit have a corresponding dashboard trigger"
  - "Each trigger invokes the equivalent CLI operation and shows real-time progress or log output"
  - "Long-running commands (analyze, plan, self-heal) display a spinner or log stream and a completion/failure notification"
  - "Destructive or irreversible operations (e.g., plan --accept, self-heal) require a confirmation step before executing"
  - "No high-priority gap command remains inaccessible from the dashboard after implementation"
description: "Based on the audit, add action buttons, panels, or workflow controls for high-impact CLI commands that have no dashboard equivalent. At minimum: ndx analyze (re-scan codebase), ndx plan (analyze + propose PRD changes), ndx sync (push/pull PRD to remote adapter), ndx export (export static dashboard), and ndx self-heal (iterative improvement loop). Each control must invoke the underlying CLI operation via the web server's MCP or REST surface, display real-time status or streaming output, and surface errors clearly."
---
