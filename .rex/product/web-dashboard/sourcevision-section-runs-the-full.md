---
id: "a83b1a2f-8315-4ba6-b10b-d70ba4f68479"
type: "capability"
title: "SourceVision section runs the full analysis flow with all tabs and recommendations visible"
slug: "sourcevision-section-runs-the-full"
statement: "The SourceVision section of the dashboard runs the full sourcevision analysis flow from the UI, fills every tab with the data it produces, and shows every recommendation and sourcevision function in a form the user can view and operate."
criteria: [{"id":"c1","text":"The SourceVision section shall provide a control that starts the full sourcevision analysis flow."},{"id":"c2","text":"While the full analysis flow is running, the SourceVision section shall display its progress state."},{"id":"c3","text":"When the full analysis flow completes, the SourceVision section shall reload every tab and display the newly produced data without a server restart."},{"id":"c4","text":"If the analysis flow fails, the SourceVision section shall display the error with an actionable message."},{"id":"c5","text":"After an analysis run, the SourceVision section shall render every tab with populated data."},{"id":"c6","text":"The SourceVision section shall render every recommendation from the next steps and the findings."},{"id":"c7","text":"The SourceVision section shall give each sourcevision MCP capability a visible UI affordance unless that capability is listed as a documented exclusion."},{"id":"c8","text":"The SourceVision section shall let the user carry out its interactive functions, including archetype overrides and zone drill-down, end to end from the UI."}]
requirements: [{"id":"a83b1a2f-8315-4ba6-b10b-d70ba4f68479:c6","title":"The SourceVision section shall render every recommendation from the next steps and the findings","description":"Linked to: packages/web/tests/unit/viewer/next-steps-panel.test.ts","category":"technical","validationType":"automated","acceptanceCriteria":["The SourceVision section shall render every recommendation from the next steps and the findings."]}]
tags:
  - "web"
  - "sourcevision"
  - "ui"
source: "ndx-capture"
priority: "high"
---

The SourceVision section of the dashboard must be able to run the complete sourcevision analysis flow from the UI so that every tab renders with populated data and all recommendations and functions are visible and operable. Today, parts of the section only show data when a full analysis has been run externally, leaving tabs empty and recommendations hidden.
