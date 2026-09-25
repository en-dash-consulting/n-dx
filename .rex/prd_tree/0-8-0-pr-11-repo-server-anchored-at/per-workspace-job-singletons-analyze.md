---
id: "a5be7ddb-5459-407b-a6bd-655a6bc141fb"
level: "feature"
title: "Per-workspace job singletons: analyze, refresh, self-heal, ci, reshape, execution state and active executions keyed by workspace"
status: "completed"
priority: "high"
tags:
  - "pr-11"
  - "web"
blockedBy:
  - "1fd545b9-b9d2-47a3-abc4-b492773aeed9"
source: "parallel-development roadmap, 2026-09-10 discovery session"
startedAt: "2026-09-16T16:30:54.272Z"
completedAt: "2026-09-16T16:41:32.840Z"
endedAt: "2026-09-16T16:41:32.840Z"
resolutionType: "code-change"
resolutionDetail: "Command job statuses and the writer lock, epic-by-epic execution state, hench active executions/metrics/memory tracker, and the status/project/config caches are keyed per workspace via WorkspaceScoped; shutdown and monitors sweep all workspaces; new per-workspace tests green and existing suites unchanged."
acceptanceCriteria:
  - "Starting `sv analyze` in workspace A does not block or report in workspace B."
  - "Execution state and active executions are reported per workspace; existing routes-hench and routes-commands tests pass."
description: "Today's process-global trackers become maps keyed by workspace key: routes-commands.ts (initStatus, svAnalyzeStatus, selfHealStatus, refreshStatus, ciStatus, reshapeStatus, the .sourcevision writer lock svWriteJob), routes-rex/execution.ts executionState + henchProcess, routes-hench.ts activeExecutions + executionMetrics + memory tracker, routes-status.ts and routes-project.ts single-slot caches, routes-config.ts configCache. Spawned commands use the workspace's projectDir as cwd and positional (they already take ctx.projectDir, so this follows from the request-scoped context). Keep the anchor's behaviour identical when it is the only workspace."
lastModified: "2026-09-16T16:41:33.214Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
