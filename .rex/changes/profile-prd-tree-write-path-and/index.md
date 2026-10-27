---
id: "bbf2dd9a-3f5a-4bb9-a263-ca8931caaaa5"
type: "change"
title: "Profile prd_tree write path and identify bottlenecks for single-item add and edit operations"
slug: "profile-prd-tree-write-path-and"
intent: "Instrument the folder-tree write path (slug generation, parent traversal, index.md serialization, file write, cache refresh) and capture timing on representative PRDs (small ~20 items, medium ~200 items, large ~1000 items). Identify the top three latency contributors and document them with concrete file:line references."
acceptanceCriteria:
  - "Profiling harness measures end-to-end latency for ndx add and rex edit_item on small/medium/large fixture PRDs"
  - "Top three bottlenecks are documented with file paths and measured cost in milliseconds"
  - "Profiling artifacts checked in under tests/ or scripts/ for repeatable runs"
  - "Baseline numbers recorded so subsequent optimization tasks can verify improvement"
touches:
  - "6e8679d3-2efa-4b4b-b6b6-d7b23f422a71"
priority: "high"
tags:
  - "rex"
  - "performance"
  - "prd"
source: "smart-add"
---
