---
id: "2eb560aa-843f-476d-864c-21ad4469ee64"
level: "task"
title: "Resume the work session for the reviewer on --resume"
status: "completed"
priority: "high"
startedAt: "2026-08-26T04:45:03.662Z"
completedAt: "2026-08-26T04:45:03.662Z"
endedAt: "2026-08-26T04:45:03.662Z"
acceptanceCriteria: []
description: "Capture session_id from the Claude CLI stream-json output onto SpawnResult (first value only, so a late malformed line cannot redirect the resume), add resumeSessionId to VendorSpawnOptions, and have the Claude adapter append the resume flag. Vendors without a resume equivalent fall back to a fresh reviewer seeded with the task context."
lastModified: "2026-08-26T04:45:03.669Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
