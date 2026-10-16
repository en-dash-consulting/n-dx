---
id: "eee4b5b6-030d-4ed3-a8c7-49cc9a75b7a2"
level: "task"
title: "Findings list items have no stray list bullets"
status: "completed"
priority: "medium"
tags:
  - "web"
  - "viewer"
  - "ui"
source: "ndx-capture"
startedAt: "2026-10-15T03:51:29.343Z"
completedAt: "2026-10-15T03:55:14.310Z"
endedAt: "2026-10-15T03:55:14.310Z"
resolutionType: "code-change"
resolutionDetail: "collapsible-list class with no list markers"
acceptanceCriteria:
  - "Finding cards render with no list marker outside the card, in every severity group."
  - "Keyboard and screen-reader semantics of the list are unchanged."
description: "Each finding card in the Problems/Suggestions list (components/data-display/findings-list.ts) shows a coloured list bullet outside its left edge."
lastModified: "2026-10-15T03:55:14.599Z"
lastModifiedBy: "Nick Daniel <nick@endash.us>"
---
