---
id: "b3ffbc17-9c74-4ca9-8583-c74941751291"
type: "change"
title: "Implement shape-based node classification and rendering for Rex context graph nodes"
slug: "implement-shape-based-node"
intent: "Classify each graph node by inspecting its position in the `.rex/prd_tree/` structure and assign a shape according to these rules: diamond — parent node that contains both an index.md and at least one other non-index.md file; square — parent node with only non-index.md files and no subdirectory children; trapezoid — parent node whose children are exclusively subdirectories (no direct files); triangle — leaf task node with no children of any kind; circle — default for nodes that don't match any rule above. Update the SVG/graph rendering layer to draw each node in its assigned shape and add a shape legend to the graph UI."
acceptanceCriteria:
  - "Nodes with index.md plus additional non-index.md siblings render as diamonds"
  - "Nodes with only non-index.md files and no subdirectory children render as squares"
  - "Nodes whose children are exclusively subdirectories render as trapezoids"
  - "Leaf nodes with no children of any kind render as triangles"
  - "Nodes that match none of the above rules render as circles"
  - "A legend is visible in the graph UI labeling each shape with its structural meaning"
  - "Shape classification logic is unit-tested with folder-tree fixtures covering all five shape categories"
amends: [{"target":"f4e984ba-0a05-47f4-8358-7f647d6f6828","delta":"modified","summary":"Implement shape-based node classification and rendering for Rex context graph nodes","base":"b1595e404f3c19b51edaf9d77130febe1f7e094d4c9827b60ac59a6ec98852ed"}]
priority: "high"
tags:
  - "ui"
  - "graph"
  - "rex"
source: "smart-add"
---
