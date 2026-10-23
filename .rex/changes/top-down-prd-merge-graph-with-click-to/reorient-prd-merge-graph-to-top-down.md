---
id: "68b54c8e-125b-439a-81a7-1810c62f3982"
type: "task"
title: "Reorient PRD merge graph to top-down layout with collapsed children by default"
slug: "reorient-prd-merge-graph-to-top-down"
description: "Change the merge graph rendering to a top-down (vertical) hierarchical layout where root PRD items are at the top and descendants flow downward. By default, render only top-level nodes with a visual affordance indicating expandable children; do not eagerly render the full tree. Clicking a node expands its immediate children inline; clicking again collapses them. Preserve existing pan/zoom and node-click-to-detail behavior from the prior context graph work."
acceptanceCriteria:
  - "Graph renders top-down with parents above children and edges flowing downward"
  - "On initial load, only top-level PRD items are visible; child nodes are hidden until their parent is clicked"
  - "Clicking a collapsed node expands its direct children with a smooth transition; clicking an expanded node collapses them"
  - "Expand/collapse state is preserved while panning, zooming, and resizing the viewport"
  - "Existing node-shape encoding and click-to-open-detail behavior from the prior Rex Context Graph work continues to function"
priority: "high"
tags:
  - "web"
  - "dashboard"
  - "rex"
  - "graph"
source: "smart-add"
---
