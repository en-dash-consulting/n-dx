---
id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
level: "task"
title: "PRD Enhancement Features in Web UI"
status: "completed"
source: "manual"
startedAt: "2026-02-08T16:08:58.456Z"
completedAt: "2026-02-08T16:08:58.456Z"
acceptanceCriteria: []
description: "Expose PRD management enhancement capabilities through the Rex web dashboard"
---

## Subtask: Add validation and dependency visualization to web UI

**ID:** `b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e`
**Status:** completed
**Priority:** medium

Add ability to run rex validate from the web UI and display results inline (orphaned items, circular dependencies, stuck tasks). Render blockedBy relationships as a visual dependency graph showing blocking chains, rather than just listing IDs in the detail panel.

**Acceptance Criteria**

- Validate button triggers rex validate and displays results in the UI
- Validation issues are categorized and actionable (click to navigate to problem item)
- Dependency graph renders blockedBy relationships visually
- Graph highlights circular dependencies and blocking chains
- Blocked items show their full dependency path

---

## Subtask: Add token usage analytics dashboard to web UI

**ID:** `c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f`
**Status:** completed
**Priority:** medium

Build a dashboard view showing token consumption across packages (rex, hench, sourcevision), grouped by command and time period, with budget status indicators and trend visualization.

**Acceptance Criteria**

- Dashboard shows token usage aggregated by package and command
- Time period grouping (day/week/month) with chart visualization
- Budget status indicators show warning/exceeded thresholds
- Filterable by date range and package
- Cost estimates displayed alongside token counts

---
