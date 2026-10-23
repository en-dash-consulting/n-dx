---
id: "3ccf116a-5601-4e0e-9a47-9d4775450da3"
type: "change"
title: "Wire full sourcevision flow trigger and tab population from the dashboard"
slug: "wire-full-sourcevision-flow-trigger"
intent: "Add a UI control in the SourceVision section that triggers the complete sourcevision analysis flow (equivalent to a full `ndx analyze`), with progress feedback. When the run finishes, refresh the section so every tab (zones, findings, imports, classifications, routes, etc.) renders with the newly produced data instead of remaining empty."
acceptanceCriteria:
  - "A control in the SourceVision section starts the full analysis flow with visible progress state"
  - "On completion, all tabs re-load and display populated data without a manual server restart"
  - "Errors during the run surface in the UI with an actionable message"
touches:
  - "a83b1a2f-8315-4ba6-b10b-d70ba4f68479"
priority: "high"
tags:
  - "web"
  - "sourcevision"
source: "ndx-capture"
---
