---
id: "8133b24f-93d1-4a97-ac2e-4da5ccd0b654"
type: "capability"
title: "Folder-Tree-Style Context Graph Visualization"
slug: "folder-tree-style-context-graph"
statement: "The Rex context graph shows the PRD as a compact, indented tree that follows the .rex/prd_tree/ folder hierarchy and keeps distinct shapes for epics, features and tasks."
criteria: [{"id":"c1","text":"The context graph shall lay out nodes top-down in an indented tree rhythm consistent with the dashboard's folder-tree view."},{"id":"c2","text":"The context graph shall render nodes with a reduced footprint (smaller cards and tighter spacing) so that a typical PRD takes less vertical space than the prior flowchart layout."},{"id":"c3","text":"The context graph shall encode epic, feature and task nodes with distinct shapes."},{"id":"c4","text":"The context graph shall key each node by its folder-tree path (the epic/feature/task slug chain)."},{"id":"c5","text":"The context graph shall order nodes in the same order as the folder-tree view."},{"id":"c6","text":"The context graph shall derive parent/child edges from folder-tree containment rather than from flowchart linkage."},{"id":"c7","text":"When a user clicks a context graph node, the dashboard shall open the Rex task detail panel for that item."},{"id":"c8","text":"The context graph shall build its hierarchy from the existing folder-tree parser instead of traversing .rex/prd_tree/ separately."}]
source: "smart-add"
---

Restructure the Rex context graph so its tree visualization mirrors the on-disk PRD folder-tree in a compact, easy-to-read style. Today the context graph uses a flowchart-style layout that does not visually echo the underlying .rex/prd_tree/ hierarchy, making the relationship between filesystem layout and graph structure hard to read. Adopting the same compact tree visual used elsewhere will make the graph denser, more scannable, and consistent with the folder-tree mental model.
