---
id: "f7a55c42-ca3b-41c2-b04c-d62a80bf826d"
level: "task"
title: "Add --review flag and move the diff-approval gate to --approve-diff"
status: "completed"
priority: "high"
startedAt: "2026-08-26T04:45:00.439Z"
completedAt: "2026-08-26T04:45:00.439Z"
endedAt: "2026-08-26T04:45:00.439Z"
acceptanceCriteria: []
description: "Reassign --review from the interactive diff gate to the adversarial review pass, and rename the existing gate to --approve-diff. The two are independent and compose: the review pass runs first so a human answering the diff prompt sees the repaired tree. Runs passing --review print a line saying where the old behavior went. Touches hench run.ts flag parsing, SharedLoopOptions (review -> approveDiff), the API loop, and both help surfaces."
lastModified: "2026-08-26T04:45:00.451Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
