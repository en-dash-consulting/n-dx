---
id: "62fb47b8-2f99-4563-9424-5b95a52a49b3"
level: "task"
title: "Apply compact folder-tree visual style to context graph rendering"
status: "completed"
priority: "high"
tags:
  - "web"
  - "rex"
  - "context-graph"
  - "ui"
source: "smart-add"
startedAt: "2026-05-08T16:59:48.851Z"
completedAt: "2026-05-08T17:25:45.653Z"
endedAt: "2026-05-08T17:25:45.653Z"
resolutionType: "code-change"
resolutionDetail: "Re-skinned MergeGraphView to use a compact, indented folder-tree layout matching the dashboard's PRD tree view. Replaced the per-level wide rhythm (ROW_H_LEVEL=110, COL_W_LEAF=180, balanced sibling spread) with DFS pre-order one-row-per-node compact rhythm (ROW_H=22, INDENT_W=22). Tree edges now render as straight L-shaped indent rails (no Béziers). Labels moved from below shape to inline-right. Node radii reduced (epic 13→7, feature 10→6, task 7→5, subtask 5→4). Added visual regression snapshot test locking exact (x,y) positions for a 5-node fixture: Epic→Feature→Task,Task,Epic at (0,0),(22,22),(44,44),(44,66),(0,88) — vertical span 88px vs prior ~330px. Shape-encoded epic/feature/task typing preserved. All 26 merge-graph tests pass; full monorepo suite green."
acceptanceCriteria:
  - "Graph layout uses a top-down indented tree rhythm visually consistent with the folder-tree view"
  - "Node footprint is reduced (smaller cards, tighter spacing) so a typical PRD fits in noticeably less vertical space than the prior flowchart layout"
  - "Existing shape-based epic/feature/task encoding from the Rex Context Graph Flowchart Restructure feature is preserved"
  - "Visual regression snapshot captures the new compact layout for at least one representative PRD fixture"
description: "Re-skin the context graph rendering to match the compact, indented folder-tree visual used in the dashboard's tree view — tight vertical rhythm, indentation guides, and minimal node chrome — so the graph reads as a denser, more scannable hierarchy rather than a sprawling flowchart. Preserve shape-encoded node typing for epic/feature/task introduced by the prior context graph restructure."
---
