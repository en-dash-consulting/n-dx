---
id: "8f8ab3e2-bd78-4dff-8f01-5545ad395728"
level: "task"
title: "Aggregate durations up the PRD tree and expose alongside token usage"
status: "completed"
priority: "medium"
tags:
  - "rex"
  - "aggregation"
  - "mcp"
source: "smart-add"
startedAt: "2026-04-23T16:54:46.650Z"
completedAt: "2026-04-23T17:11:13.151Z"
resolutionType: "code-change"
resolutionDetail: "Added pure aggregateItemDurations to rex core (packages/rex/src/core/item-duration-rollup.ts), extended the get_token_usage MCP handler to return { tokens, duration } per item, wired duration through the web rex-gateway and /api/hench/task-usage endpoint, and updated the dashboard viewer to consume rolled-up duration for parent rows. 12 new rex tests + 2 new web wire tests. Completed subtrees report stable totalMs; running subtrees report live runningMs via injected `now`. No mutation of stored interval state."
acceptanceCriteria:
  - "The PRD status accessor returns `{ tokens, duration }` for every item, where `duration` is `{ totalMs, runningMs, isRunning }`"
  - "Running duration updates on each call based on `now` without mutating stored state"
  - "Completed subtrees report a stable `totalMs` that does not change between calls"
  - "Tests cover: epic with all completed tasks, epic with one running task, and epic with a re-opened task whose intervals overlap chronologically"
description: "Extend the rollup layer so features and epics report total time spent (sum of descendant task durations) and, for in-progress subtrees, a live running duration. Expose these values through the same rex accessor/MCP tool that serves token rollups so the dashboard can fetch both in one call."
---
