---
id: "fded9838-349c-4cdc-97d3-ba5ff0d2e8eb"
level: "task"
title: "Decide whether rex's trailer reader recovers a split-off N-DX-Item line"
status: "completed"
priority: "medium"
source: "review"
startedAt: "2026-10-16T05:09:00.438Z"
completedAt: "2026-10-16T05:14:10.424Z"
endedAt: "2026-10-16T05:14:10.424Z"
acceptanceCriteria:
  - "A recorded decision: relax rex's trailer reader for split-off N-DX-Item lines, or accept that those commits stay unattributed, with the reason"
  - "If relaxed: a test where N-DX-Item / blank line / Co-Authored-By is attributed to the item, and a merge commit quoting a trailer in its body is not"
description: "From Ryan's review of #605 (2026-10-08 23:33Z); decision D3 (Ryan, 2026-10-08) to capture it here rather than in the PR 5 follow-up branch. Commits already on main whose N-DX-Item sits in a paragraph before the final trailer block (e.g. c40510b5c, d718b6c15, 2d38ade41) stay invisible to computeChangeCommits, which reads `%(trailers:key=N-DX-Item)` through git's parser. Fixing the writers (PR 5 follow-ups) only helps new commits. Design call: relax the reader to recover a split-off line, or accept the gap. PR 13's migration plan and PR 26 attribute history through this reader."
assignee: "Sterling H <sterling.h@endash.us>"
lastModified: "2026-10-16T05:14:11.016Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
