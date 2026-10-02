---
id: "9b20d881-bd59-495f-8a92-abd2a6f3abad"
level: "task"
title: "Record the agent process pid on the run record for every run"
status: "completed"
priority: "medium"
tags:
  - "live"
  - "hench"
startedAt: "2026-10-01T01:44:15.210Z"
completedAt: "2026-10-01T02:22:40.554Z"
endedAt: "2026-10-01T02:22:40.554Z"
acceptanceCriteria:
  - "A terminal-started run's record shows its pid within one heartbeat of starting."
  - "The web server's stale-run check reports whether the recorded pid is still alive alongside the heartbeat age."
  - "Records without the pid fields still load and are treated as pid unknown."
  - "Changeset for @n-dx/hench and @n-dx/web (patch)."
description: "The pid of a running task is known only to the web server's audit entry (`AuditEntry.pid` in `packages/web/src/server/routes-hench.ts`) and only for runs the dashboard started. Write the hench process pid (and the spawned vendor CLI pid where there is one) to the run record when the run starts, as optional fields in `packages/hench/src/schema/v1.ts` and `validate.ts`, and refresh them with the existing 30-second heartbeat (`agent/lifecycle/heartbeat.ts`). The Live tab uses this to tell a slow run from a dead one (\"pid 23110 not found\") and to offer Stop for terminal-started runs."
lastModified: "2026-10-01T02:22:40.944Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
