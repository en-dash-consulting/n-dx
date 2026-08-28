---
id: "0deece15-2acc-4b40-bd91-d6b6f32a1677"
level: "task"
title: "Verify the review pass end-to-end against a real ndx work run"
status: "completed"
priority: "high"
blockedBy:
  - "976d34af-75f4-4fe3-bd74-15afed3413e9"
startedAt: "2026-08-27T16:18:31.496Z"
completedAt: "2026-08-28T17:48:08.340Z"
endedAt: "2026-08-28T17:48:08.340Z"
resolutionType: "code-change"
resolutionDetail: "Live e2e run ea962353 (ndx work --task=8c5cc23d --review --review-model=claude-sonnet-5) exercised the spawn path: reviewer resumed the work session on the override model, wrote a parseable report, captured a finding via rex MCP, and charged 29,244 output + 11.36M cache-read tokens to the run. The must-fix repair path did not occur (no must-fix finding, fixesApplied=false) and is tracked as follow-up f29a5567. Reproduced two known display/gate defects live, recorded on c971145e and 0ba847e0."
acceptanceCriteria: []
description: "Everything so far is verified by unit tests and by probing the Claude CLI directly (session_id is on every stream-json line; resume with a different model retains context, confirmed by cache reads). The spawn path itself has not been exercised end-to-end: run ndx work with review enabled against a real task and confirm the reviewer resumes, writes a parseable report, applies a must-fix repair before the commit prompt, and charges its tokens to the run."
lastModified: "2026-08-28T17:48:08.365Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
