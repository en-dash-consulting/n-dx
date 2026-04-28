---
id: "94f1e7cc-da17-4ea9-b86d-1696de282b97"
level: "task"
title: "Add Hench section to web UI"
status: "completed"
priority: "medium"
tags:
  - "web"
  - "hench"
startedAt: "2026-02-09T18:30:32.410Z"
completedAt: "2026-02-09T18:30:32.410Z"
description: "Add a Hench section to the sidebar as the execution arm of Rex. Relatively minor compared to SourceVision and Rex — focused on showing run history, run status, and linking runs back to the Rex tasks they executed. Hench data lives in .hench/runs/."
---

## Subtask: Add Hench Runs view showing execution history

**ID:** `48bd8e20-8ecf-4fde-b037-037cdfa2ae11`
**Status:** completed
**Priority:** medium

Create a hench-runs view that reads from .hench/runs/ and displays: list of past runs with task ID, status (success/failure), timestamp, duration, and token usage. Clicking a run shows the transcript/detail. Link each run back to its Rex task. Needs a new API endpoint to serve hench run data to the frontend.

---

## Subtask: Add Hench API endpoints to web server

**ID:** `8ab205ae-dfb1-4b48-b4b2-f2aee008c7f5`
**Status:** completed
**Priority:** medium

Add /api/hench/* endpoints to the web server (packages/sourcevision/src/cli/server/): GET /api/hench/runs (list runs with summary), GET /api/hench/runs/:id (full run detail with transcript). Read from .hench/runs/ directory. Follow the same patterns as the existing /api/rex/* endpoints.

---
