---
id: "d001b4cf-b90c-48ae-b8c2-e1a422841516"
level: "task"
title: "Web UI Epic-by-Epic Execution"
status: "completed"
source: "smart-add"
startedAt: "2026-02-10T19:22:25.616Z"
completedAt: "2026-02-10T19:22:25.616Z"
description: "Enable epic-by-epic execution mode from the web dashboard with visual progress tracking and control interfaces\n\n---\n\nEnable sequential epic processing through CLI commands with automatic progression and completion detection"
---

## Subtask: Build epic-by-epic execution interface and API

**ID:** `7ca365dd-2f22-4a64-9de0-97cdf2c5209c`
**Status:** completed
**Priority:** high

Create complete web UI controls and backend API endpoints to support epic-by-epic execution with real-time progress tracking and execution control

**Acceptance Criteria**

- Provides start epic-by-epic execution button in Rex dashboard
- Shows current epic being processed with visual indicator
- Displays progress bar for epic completion
- Includes pause/resume controls for execution
- Shows list of epics with completion status indicators
- Highlights currently active epic during execution
- Displays task completion counts for each epic
- POST /api/rex/execute/epic-by-epic endpoint to start execution
- GET /api/rex/execute/status endpoint for current execution state
- POST /api/rex/execute/pause and resume endpoints
- WebSocket or SSE support for real-time progress updates

---

## Subtask: Implement epic-by-epic execution mode in hench and orchestration

**ID:** `528c2df2-4e8d-48fa-b296-4a9b28f6e647`
**Status:** completed
**Priority:** high

Add --epic-by-epic flag support to hench run and n-dx work commands with logic to detect epic completion and automatically advance to next epic with pending tasks

**Acceptance Criteria**

- Accepts --epic-by-epic flag in hench run command
- Maintains current epic context across multiple task executions
- Detects when all tasks in current epic are completed or blocked
- Automatically selects next epic with actionable tasks
- Passes flag through n-dx work orchestration command
- Displays current epic being processed in output
- Shows epic completion and advancement messages
- Provides summary of epics processed when execution completes
- Respects task dependencies within and across epics

---
