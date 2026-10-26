---
id: "ef7ca789-393d-4663-ac58-8aba713c51ad"
type: "task"
title: "Sidecar lifecycle in the hub"
slug: "sidecar-lifecycle-in-the-hub"
acceptanceCriteria:
  - "First request to `/x/<name>/` starts the sidecar on an ephemeral loopback port and waits for `health`; 503 naming the log file after 20 s"
  - "Idle stop after `idleStopMinutes` with no requests and no open WebSocket; `ndx hub stop` stops all sidecars"
  - "Restart on next request after a crash, with backoff after three crashes in five minutes; logs in `<ndx home>/ext/<name>/logs/`"
  - "Refuses to start below the hub's memory floor, with a clear message"
priority: "high"
tags:
  - "extensions"
source: "ndx-capture"
blockedBy:
  - "165648b5-2c3b-48b2-8911-fe42059c4381"
  - "6ab3826a-a3ed-47aa-a2b5-2fd4896ac98c"
---
