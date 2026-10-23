---
id: "62fb47b8-2f99-4563-9424-5b95a52a49b3"
type: "change"
title: "Apply compact folder-tree visual style to context graph rendering"
slug: "apply-compact-folder-tree-visual-style"
intent: "Re-skin the context graph rendering to match the compact, indented folder-tree visual used in the dashboard's tree view — tight vertical rhythm, indentation guides, and minimal node chrome — so the graph reads as a denser, more scannable hierarchy rather than a sprawling flowchart. Preserve shape-encoded node typing for epic/feature/task introduced by the prior context graph restructure."
acceptanceCriteria:
  - "Graph layout uses a top-down indented tree rhythm visually consistent with the folder-tree view"
  - "Node footprint is reduced (smaller cards, tighter spacing) so a typical PRD fits in noticeably less vertical space than the prior flowchart layout"
  - "Existing shape-based epic/feature/task encoding from the Rex Context Graph Flowchart Restructure feature is preserved"
  - "Visual regression snapshot captures the new compact layout for at least one representative PRD fixture"
touches:
  - "8133b24f-93d1-4a97-ac2e-4da5ccd0b654"
priority: "high"
tags:
  - "web"
  - "rex"
  - "context-graph"
  - "ui"
source: "smart-add"
---
