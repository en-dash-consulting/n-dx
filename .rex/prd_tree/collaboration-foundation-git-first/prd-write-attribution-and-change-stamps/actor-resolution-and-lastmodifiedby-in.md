---
id: "3bb12517-a6e4-4032-b7c7-5b1c2f51b477"
level: "task"
title: "Actor resolution and lastModifiedBy in rex"
status: "completed"
priority: "high"
startedAt: "2026-08-21T03:51:57.003Z"
completedAt: "2026-08-21T04:02:59.586Z"
endedAt: "2026-08-21T04:02:59.586Z"
acceptanceCriteria: []
description: "Add a small identity util to rex: resolve git config user.name/user.email with os.userInfo() fallback, cached per process. Stamp lastModifiedBy on PRD item mutations and actor on LogEntry appends — both schemas have passthrough index signatures, so this is additive and non-breaking. PR boundary: rex package only; no hench, no dashboard UI. Acceptance criteria: (1) mutations carry lastModifiedBy; (2) appendLog entries carry actor; (3) util degrades gracefully when git config is unset; (4) unit tests for resolution order and caching."
lastModified: "2026-08-21T04:10:11.630Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
