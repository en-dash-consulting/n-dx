---
id: "0deece15-2acc-4b40-bd91-d6b6f32a1677"
level: "task"
title: "Verify the review pass end-to-end against a real ndx work run"
status: "in_progress"
priority: "high"
blockedBy:
  - "976d34af-75f4-4fe3-bd74-15afed3413e9"
startedAt: "2026-08-27T16:18:31.496Z"
acceptanceCriteria: []
description: "Everything so far is verified by unit tests and by probing the Claude CLI directly (session_id is on every stream-json line; resume with a different model retains context, confirmed by cache reads). The spawn path itself has not been exercised end-to-end: run ndx work with review enabled against a real task and confirm the reviewer resumes, writes a parseable report, applies a must-fix repair before the commit prompt, and charges its tokens to the run."
lastModified: "2026-08-28T17:24:21.056Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
