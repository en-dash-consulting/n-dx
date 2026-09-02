---
id: "1c505fec-1e3c-4fa3-aecd-eb6d3e35dd7f"
level: "task"
title: "Drive context graph hierarchy from PRD folder-tree paths"
status: "completed"
priority: "high"
tags:
  - "web"
  - "rex"
  - "context-graph"
source: "smart-add"
startedAt: "2026-05-08T17:27:07.100Z"
completedAt: "2026-05-08T18:01:25.238Z"
endedAt: "2026-05-08T18:01:25.238Z"
resolutionType: "code-change"
resolutionDetail: "Replaced merge-history flattenPrdItems' homemade slugger and disk-walking shape classifier with rex's canonical resolveSiblingSlugs and a pure tree-derived classifier. Each PrdNode now carries a treePath slug-chain matching the .rex/prd_tree/ folder layout exactly; ordering, parentId and shape all flow from the parsed PRD tree, so the context graph mirrors the dashboard folder-tree view by construction. Click-through still keys on item id (unchanged). No new disk traversal: parseFolderTree (upstream of loadPRDSync) is the sole hierarchy source."
acceptanceCriteria:
  - "Context graph nodes are keyed by folder-tree path (epic/feature/task slug chain) and match the order shown in the folder-tree view"
  - "Parent/child edges in the graph are derived from folder-tree containment, not from the legacy flowchart linkage"
  - "Existing context graph node click-through to the Rex task detail panel continues to work unchanged"
  - "Graph reuses the existing folder-tree parser (no duplicate traversal of .rex/prd_tree/)"
description: "Replace the current graph node ordering and parent/child resolution with a mapping derived directly from the .rex/prd_tree/ folder structure, so each node corresponds to a folder-tree path and the graph edges reflect the same parent/child relationships used by the folder-tree renderer. Reuse existing folder-tree parsing utilities rather than introducing a parallel data path."
---
