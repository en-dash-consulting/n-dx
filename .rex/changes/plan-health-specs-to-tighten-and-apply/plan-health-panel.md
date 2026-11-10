---
id: "7441aa5c-1555-443d-8a95-5df1ac4903d1"
type: "task"
title: "Plan health panel"
slug: "plan-health-panel"
description: "A new StagePanelId `plan-health` for the Validation tile: the last validation result as up to four lights (cycles, orphans, unresolved dependencies, stale release plans), when it ran, and Check, Fix… and Reshape… buttons that use the existing validation view's actions (Fix and Reshape preview before writing). Open ↗ goes to the full Validation view."
acceptanceCriteria:
  - "The tile shows the last validation result as lights with the time it ran"
  - "Check runs validation and updates the lights"
  - "Fix and Reshape open their existing previews and write nothing without confirmation"
priority: "medium"
source: "ndx-capture"
blockedBy:
  - "9156347e-7193-4d2e-9108-635e9e3705ad"
---
