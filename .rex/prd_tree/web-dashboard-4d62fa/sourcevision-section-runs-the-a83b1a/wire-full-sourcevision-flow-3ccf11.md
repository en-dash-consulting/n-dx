---
id: "3ccf116a-5601-4e0e-9a47-9d4775450da3"
level: "task"
title: "Wire full sourcevision flow trigger and tab population from the dashboard"
status: "completed"
priority: "high"
tags:
  - "web"
  - "sourcevision"
source: "ndx-capture"
startedAt: "2026-08-12T22:59:21.880Z"
completedAt: "2026-08-12T23:05:14.638Z"
endedAt: "2026-08-12T23:05:14.638Z"
acceptanceCriteria:
  - "A control in the SourceVision section starts the full analysis flow with visible progress state"
  - "On completion, all tabs re-load and display populated data without a manual server restart"
  - "Errors during the run surface in the UI with an actionable message"
description: "Add a UI control in the SourceVision section that triggers the complete sourcevision analysis flow (equivalent to a full `ndx analyze`), with progress feedback. When the run finishes, refresh the section so every tab (zones, findings, imports, classifications, routes, etc.) renders with the newly produced data instead of remaining empty."
---
