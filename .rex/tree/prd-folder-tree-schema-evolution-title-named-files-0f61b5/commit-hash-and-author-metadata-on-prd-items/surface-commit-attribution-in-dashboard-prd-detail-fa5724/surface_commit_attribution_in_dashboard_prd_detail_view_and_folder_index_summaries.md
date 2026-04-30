---
id: "fa572435-b461-4086-b370-97cfb9edd2b6"
level: "task"
title: "Surface commit attribution in dashboard PRD detail view and folder index summaries"
status: "completed"
priority: "medium"
tags:
  - "web"
  - "ui"
  - "prd"
source: "smart-add"
startedAt: "2026-04-30T14:02:14.454Z"
completedAt: "2026-04-30T14:27:55.473Z"
endedAt: "2026-04-30T14:27:55.473Z"
resolutionType: "code-change"
resolutionDetail: "Implemented commit attribution surfacing with table rendering in detail panel and index.md summaries, comprehensive tests, and CSS styling."
acceptanceCriteria:
  - "Detail panel shows a commits table with author, short hash (linked to remote when configured), full hash on hover, and timestamp"
  - "`index.md` summary's per-task commit section consumes the same data source"
  - "Empty `commits` arrays render an explicit 'no commits recorded' state, not a broken table"
  - "Visual regression coverage for the new commits table"
  - "End-to-end test: complete a task, refresh dashboard, assert commit appears in both detail panel and parent folder index.md"
description: "Display the `commits` array in the dashboard PRD detail panel (with author, short-hash, link to remote, timestamp) and feed the same data into the folder-level `index.md` per-task commit list. Ensure the rendering is consistent across both surfaces and degrades gracefully when no commits are recorded."
---
