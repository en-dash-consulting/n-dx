---
id: "37458c57-6f30-4802-b5fd-8a41e35bfd0a"
level: "task"
title: "Admission gate in the hub for execute requests: global cap, memory floor, FIFO queue with position broadcasts, ~/.n-dx/config.json"
status: "completed"
priority: "medium"
tags:
  - "pr-15"
  - "web"
blockedBy:
  - "f7a6d344-fe86-4cff-b003-e1d2e1057330"
  - "a5be7ddb-5459-407b-a6bd-655a6bc141fb"
source: "parallel-development roadmap, 2026-09-10 discovery session"
startedAt: "2026-09-17T02:25:29.880Z"
completedAt: "2026-09-17T02:36:32.227Z"
endedAt: "2026-09-17T02:36:32.227Z"
resolutionType: "code-change"
resolutionDetail: "hub/admission.ts gates execute requests on a machine-wide session cap and memory floor, queues FIFO with 202 + position, drains by poll; ~/.n-dx/config.json gains maxSessions and memoryFloorBytes with problems reported once at start; GET /api/hub/queue exposes the state. The viewer push is captured separately as ca54925b."
acceptanceCriteria:
  - "Unit tests for the gate decision and queue ordering; integration test with two fake children and maxSessions = 1."
  - "Config file parsing with defaults and validation errors reported once at hub start."
description: "packages/web/src/hub/admission.ts: intercept POST /p/:id/(w/:wt/)?api/hench/execute/:taskId; count running dashboard-started executions across children (poll each child's /api/hench/execute/status or have children report via an internal /api/hub/executions callback); if running < hub.maxSessions and os.freemem() > hub.memoryFloorBytes, forward; else enqueue { projectId, workspace, taskId, enqueuedAt } and respond 202 { queued: true, position }. Drain FIFO on completion events (children's hench:task-execution-progress frames pass through the proxy; the hub listens). Broadcast hub:queue-changed to the affected project's clients (tagged with workspace). Config loader for ~/.n-dx/config.json with defaults { hub: { port: 3117, keepAlive: false, maxSessions: 4, memoryFloorBytes: 2 GiB } }; the Overview machine strip (PR 13) shows queue length and \"admission paused: low memory\"."
lastModified: "2026-09-17T02:36:32.608Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
