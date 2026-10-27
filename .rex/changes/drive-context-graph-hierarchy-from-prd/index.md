---
id: "1c505fec-1e3c-4fa3-aecd-eb6d3e35dd7f"
type: "change"
title: "Drive context graph hierarchy from PRD folder-tree paths"
slug: "drive-context-graph-hierarchy-from-prd"
intent: "Replace the current graph node ordering and parent/child resolution with a mapping derived directly from the .rex/prd_tree/ folder structure, so each node corresponds to a folder-tree path and the graph edges reflect the same parent/child relationships used by the folder-tree renderer. Reuse existing folder-tree parsing utilities rather than introducing a parallel data path."
acceptanceCriteria:
  - "Context graph nodes are keyed by folder-tree path (epic/feature/task slug chain) and match the order shown in the folder-tree view"
  - "Parent/child edges in the graph are derived from folder-tree containment, not from the legacy flowchart linkage"
  - "Existing context graph node click-through to the Rex task detail panel continues to work unchanged"
  - "Graph reuses the existing folder-tree parser (no duplicate traversal of .rex/prd_tree/)"
touches:
  - "8133b24f-93d1-4a97-ac2e-4da5ccd0b654"
priority: "high"
tags:
  - "web"
  - "rex"
  - "context-graph"
source: "smart-add"
---
