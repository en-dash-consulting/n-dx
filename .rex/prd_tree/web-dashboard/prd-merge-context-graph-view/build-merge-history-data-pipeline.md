---
id: "3b7bdd81-eb20-42c7-89b1-145131665551"
level: "task"
title: "Build merge history data pipeline linking git merges to PRD items"
status: "completed"
priority: "high"
tags:
  - "web"
  - "backend"
  - "prd"
  - "git"
source: "smart-add"
startedAt: "2026-04-23T19:16:08.551Z"
completedAt: "2026-04-24T19:31:22.575Z"
acceptanceCriteria:
  - "New dashboard API endpoint returns a graph payload containing PRD nodes, merge nodes, and edges between them"
  - "Merge commits are correlated to PRD items using commit message references, hench run metadata, and branch names"
  - "Endpoint returns file change summaries (added/modified/deleted paths) per merge"
  - "Payload is incrementally cacheable and invalidates when new merges land or PRD is updated"
  - "Unit and integration tests cover merge-to-PRD correlation, including merges with no PRD linkage"
description: "Create a backend data pipeline that walks the git log for merge commits, extracts the files and PRD item IDs affected in each merge (via commit message parsing and hench run attribution), and serves the merged graph data through a new dashboard API endpoint. This is the data foundation for the visualization — without accurate merge-to-PRD linkage, the visual graph is just a tree."
---
