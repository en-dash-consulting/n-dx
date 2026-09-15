---
id: "37458c57-6f30-4802-b5fd-8a41e35bfd0a"
level: "task"
title: "Admission gate in the hub for execute requests: global cap, memory floor, FIFO queue with position broadcasts, ~/.n-dx/config.json"
status: "pending"
priority: "medium"
tags:
  - "pr-15"
  - "web"
blockedBy:
  - "f7a6d344-fe86-4cff-b003-e1d2e1057330"
  - "a5be7ddb-5459-407b-a6bd-655a6bc141fb"
source: "parallel-development roadmap, 2026-09-10 discovery session"
acceptanceCriteria:
  - "Unit tests for the gate decision and queue ordering; integration test with two fake children and maxSessions = 1."
  - "Config file parsing with defaults and validation errors reported once at hub start."
description: "packages/web/src/hub/admission.ts: intercept POST /p/:id/(w/:wt/)?api/hench/execute/:taskId; count running dashboard-started executions across children (poll each child's /api/hench/execute/status or have children report via an internal /api/hub/executions callback); if running < hub.maxSessions and os.freemem() > hub.memoryFloorBytes, forward; else enqueue { projectId, workspace, taskId, enqueuedAt } and respond 202 { queued: true, position }. Drain FIFO on completion events (children's hench:task-execution-progress frames pass through the proxy; the hub listens). Broadcast hub:queue-changed to the affected project's clients (tagged with workspace). Config loader for ~/.n-dx/config.json with defaults { hub: { port: 3117, keepAlive: false, maxSessions: 4, memoryFloorBytes: 2 GiB } }; the Overview machine strip (PR 13) shows queue length and \"admission paused: low memory\"."
lastModified: "2026-09-10T20:12:37.608Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
