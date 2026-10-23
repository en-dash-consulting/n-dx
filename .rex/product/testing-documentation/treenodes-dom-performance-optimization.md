---
id: "e93f313b-dc70-41b1-8e14-63b220123347"
type: "capability"
title: "TreeNodes DOM Performance Optimization"
slug: "treenodes-dom-performance-optimization"
statement: "The tree view keeps large trees responsive by sharing event listeners across nodes, creating DOM nodes only for items in the viewport, and reporting metrics on its DOM performance."
criteria: [{"id":"c1","text":"The tree view shall handle events for a large tree without attaching a separate event listener to each node."},{"id":"c2","text":"The tree view shall wait to create a node's DOM until that node is needed."},{"id":"c3","text":"The tree view shall create DOM nodes only for tree items that are visible in the viewport."},{"id":"c4","text":"The tree view shall record metrics on its DOM performance so that bottlenecks can be identified."}]
source: "smart-add"
---
