---
id: "a5be7ddb-5459-407b-a6bd-655a6bc141fb"
level: "task"
title: "Per-workspace job singletons: analyze, refresh, self-heal, ci, reshape, execution state and active executions keyed by workspace"
status: "pending"
priority: "high"
tags:
  - "pr-11"
  - "web"
blockedBy:
  - "1fd545b9-b9d2-47a3-abc4-b492773aeed9"
source: "parallel-development roadmap, 2026-09-10 discovery session"
acceptanceCriteria:
  - "Starting `sv analyze` in workspace A does not block or report in workspace B."
  - "Execution state and active executions are reported per workspace; existing routes-hench and routes-commands tests pass."
description: "Today's process-global trackers become maps keyed by workspace key: routes-commands.ts (initStatus, svAnalyzeStatus, selfHealStatus, refreshStatus, ciStatus, reshapeStatus, the .sourcevision writer lock svWriteJob), routes-rex/execution.ts executionState + henchProcess, routes-hench.ts activeExecutions + executionMetrics + memory tracker, routes-status.ts and routes-project.ts single-slot caches, routes-config.ts configCache. Spawned commands use the workspace's projectDir as cwd and positional (they already take ctx.projectDir, so this follows from the request-scoped context). Keep the anchor's behaviour identical when it is the only workspace."
lastModified: "2026-09-10T20:12:23.840Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
