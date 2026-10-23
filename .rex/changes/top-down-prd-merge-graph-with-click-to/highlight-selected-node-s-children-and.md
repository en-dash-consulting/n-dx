---
id: "8d85a3c0-8091-4e85-b585-424ba86bff49"
type: "task"
title: "Highlight selected node's children and show inline PRD front-matter summary"
slug: "highlight-selected-node-s-children-and"
description: "When a node is clicked in the merge graph, visually highlight that node and all of its descendant child nodes (e.g. via color/stroke emphasis or dimming non-descendants) and surface a concise PRD front-matter summary for the selected item — title, status, priority, tags, and any other key frontmatter fields already present on the PRD item — rendered adjacent to the graph (popover, side panel, or inline card per existing dashboard conventions)."
acceptanceCriteria:
  - "Clicking a node visually highlights the node and all descendants (direct and transitive children)"
  - "Selecting a different node clears the previous highlight and applies the new selection"
  - "Front-matter summary displays the PRD item title, status, priority, and tags for the selected node"
  - "Front-matter values are sourced from the existing PRD item schema; no new schema fields introduced"
  - "Empty/missing front-matter fields render gracefully (omitted or shown as '—') without layout breakage"
priority: "high"
tags:
  - "web"
  - "dashboard"
  - "rex"
  - "graph"
source: "smart-add"
---
