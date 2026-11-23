---
id: "374df08e-08ca-4f94-bcbe-7bcf1dd0f630"
type: "change"
title: "Archetype cells and select controls look like styled selects, with room for the arrow"
slug: "archetype-cells-and-select-controls"
intent: "In the Files table (views/files.ts) the Archetype cell renders as an unstyled native button until clicked, then becomes a styled select, so rows look inconsistent. Select controls such as \"All severities\" / \"All zones\" have no right padding before the dropdown arrow."
acceptanceCriteria:
  - "Every Archetype cell looks the same whether or not it has been clicked (styled like the select it becomes, or a styled select from the start)."
  - "Select controls across the viewer leave right padding between their text, the arrow and the border."
touches:
  - "b39d3ad8-6c3c-4e9b-9788-d18168348f90"
priority: "medium"
tags:
  - "web"
  - "viewer"
  - "ui"
  - "forms"
source: "ndx-capture"
---
