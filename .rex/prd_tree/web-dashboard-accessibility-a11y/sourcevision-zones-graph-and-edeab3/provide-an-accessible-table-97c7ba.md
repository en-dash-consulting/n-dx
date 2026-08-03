---
id: "97c7baaf-7e49-4f31-aa3b-39c70dc984ac"
level: "task"
title: "Provide an accessible table/list alternative representation for zone graph data"
status: "pending"
priority: "high"
tags:
  - "a11y"
  - "sourcevision"
  - "zones"
  - "screen-reader"
source: "smart-add"
acceptanceCriteria:
  - "A visible 'Switch to table view' / 'Switch to graph view' toggle button is accessible from the zones page without reaching the graph first"
  - "The table view lists all visible zones with columns: Zone Name, Files, Cohesion, Coupling, Top Connections, Findings"
  - "The table is a semantic <table> with <th> column headers and correct scope attributes"
  - "Clicking a zone row in the table opens the same detail slideout as clicking a graph node"
  - "Filter/search state applied to the graph is reflected in the table view and vice versa"
  - "User's last-used view preference (graph or table) is persisted in localStorage"
description: "Graph visualizations are fundamentally difficult for screen reader users even with ARIA enhancements. Add a toggle (keyboard-accessible button near the graph) that switches the zone view from the graphical layout to a semantic HTML table or definition list showing each zone's name, file count, cohesion, coupling, connected zones, and findings count. The tabular view must be fully navigable with standard table keyboard controls and must remain synchronized with filter/selection state from the graph view."
---
