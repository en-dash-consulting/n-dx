---
id: "3b7bdd81-eb20-42c7-89b1-145131665551"
type: "change"
title: "Build merge history data pipeline linking git merges to PRD items"
slug: "build-merge-history-data-pipeline"
intent: "Create a backend data pipeline that walks the git log for merge commits, extracts the files and PRD item IDs affected in each merge (via commit message parsing and hench run attribution), and serves the merged graph data through a new dashboard API endpoint. This is the data foundation for the visualization — without accurate merge-to-PRD linkage, the visual graph is just a tree."
acceptanceCriteria:
  - "New dashboard API endpoint returns a graph payload containing PRD nodes, merge nodes, and edges between them"
  - "Merge commits are correlated to PRD items using commit message references, hench run metadata, and branch names"
  - "Endpoint returns file change summaries (added/modified/deleted paths) per merge"
  - "Payload is incrementally cacheable and invalidates when new merges land or PRD is updated"
  - "Unit and integration tests cover merge-to-PRD correlation, including merges with no PRD linkage"
touches:
  - "a32f8a34-2c34-4ea1-9652-d85d0ba4e8d2"
priority: "high"
tags:
  - "web"
  - "backend"
  - "prd"
  - "git"
source: "smart-add"
---
