---
id: "1677cbb6-9e15-4c05-bd99-974f58f243da"
level: "task"
title: "Actor attribution on hench RunRecord"
status: "completed"
priority: "medium"
startedAt: "2026-08-21T04:20:54.777Z"
completedAt: "2026-08-21T04:28:54.778Z"
endedAt: "2026-08-21T04:28:54.778Z"
acceptanceCriteria: []
description: "RunRecord has no user/host attribution — runs are anonymous. Stamp actor (name/email) and optional host on RunRecord at run start, reusing the rex identity util through the established gateway pattern (src/prd/rex-gateway.ts) or a local copy if the gateway surface should not grow. PR boundary: hench package only. Acceptance criteria: (1) new runs carry actor; (2) schema change is additive — existing run files still parse; (3) run summary/show surfaces the actor; (4) unit test covers a run record with and without actor."
lastModified: "2026-08-21T04:28:54.785Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
