---
id: "8f8ab3e2-bd78-4dff-8f01-5545ad395728"
type: "change"
title: "Aggregate durations up the PRD tree and expose alongside token usage"
slug: "aggregate-durations-up-the-prd-tree"
intent: "Extend the rollup layer so features and epics report total time spent (sum of descendant task durations) and, for in-progress subtrees, a live running duration. Expose these values through the same rex accessor/MCP tool that serves token rollups so the dashboard can fetch both in one call."
acceptanceCriteria:
  - "The PRD status accessor returns `{ tokens, duration }` for every item, where `duration` is `{ totalMs, runningMs, isRunning }`"
  - "Running duration updates on each call based on `now` without mutating stored state"
  - "Completed subtrees report a stable `totalMs` that does not change between calls"
  - "Tests cover: epic with all completed tasks, epic with one running task, and epic with a re-opened task whose intervals overlap chronologically"
touches:
  - "db3f2b10-1f3d-46be-a276-9274fceff25d"
priority: "medium"
tags:
  - "rex"
  - "aggregation"
  - "mcp"
source: "smart-add"
---
