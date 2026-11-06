---
id: "637d5b5b-b14e-441d-aa14-3c8944fec4fa"
type: "task"
title: "Shipped (the PRD Graph) works on a v2 tree"
slug: "shipped-the-prd-graph-works-on-a-v2-tree"
description: "merge-graph.ts still describes `.rex/prd_tree/` and epics, features and tasks. On a v2 project it must draw changes and their tasks and link each to the merge commits that shipped it, using N-DX-Item trailers (commit identity is the trailer, never a SHA). Check what it renders on this repository's v2 tree and fix what is v1-only; v1 projects keep their current graph."
acceptanceCriteria:
  - "On a v2 fixture the graph shows changes and their tasks, not epics and features"
  - "A merge commit links to the items its N-DX-Item trailers name"
  - "On a v1 fixture the graph renders as before"
  - "The view's module header describes both layouts"
priority: "medium"
source: "ndx-capture"
blockedBy:
  - "105510b0-625b-4afd-8e26-a2bbdc79968d"
---
