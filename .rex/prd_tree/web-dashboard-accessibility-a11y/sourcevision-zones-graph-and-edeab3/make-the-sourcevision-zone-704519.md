---
id: "704519ae-55ab-4f76-bfae-2487ce2a8223"
level: "task"
title: "Make the SourceVision zone graph keyboard-navigable with ARIA roles and node/edge descriptions"
status: "pending"
priority: "high"
tags:
  - "a11y"
  - "sourcevision"
  - "zones"
  - "graph"
  - "keyboard-nav"
source: "smart-add"
acceptanceCriteria:
  - "Every zone node in the SVG graph is reachable by Tab/Shift-Tab and activatable by Enter or Space"
  - "Arrow keys navigate between nodes connected by edges from the currently focused node"
  - "Each node has aria-label='<Zone Name> zone, cohesion <x>, coupling <y>, <n> files' or equivalent announced by screen readers"
  - "Activating a node via keyboard opens the same slideout/detail panel as a mouse click"
  - "Focus ring is visible on the currently focused SVG node in both light and dark themes"
description: "The force-directed SVG zone graph currently requires mouse interaction to explore zones and their connections. Add keyboard focus management to SVG nodes (role='button' or role='treeitem' where appropriate), allow arrow-key traversal between connected zones, and assign each node an aria-label that describes the zone name, cohesion/coupling scores, and file count. Edge relationships should be described via aria-describedby on each node listing its top connected zones. This makes the graph explorable without a pointing device."
---
