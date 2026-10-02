---
id: "c1874b13-d3ac-402a-93ac-fe49c773c37b"
level: "task"
title: "Add the Log tab to the running-task page: the raw terminal stream with follow, filter and search"
status: "completed"
priority: "medium"
tags:
  - "live"
  - "web-viewer"
blockedBy:
  - "8050220c-7add-4547-8806-0fc6765acb82"
  - "b1dd0bde-32a5-418c-a046-917e7d407181"
startedAt: "2026-10-01T05:46:05.721Z"
completedAt: "2026-10-01T05:54:49.123Z"
endedAt: "2026-10-01T05:54:49.123Z"
resolutionType: "code-change"
resolutionDetail: "Log tab: windowed raw log with follow, filters, search, jump to turn, download"
acceptanceCriteria:
  - "New lines appear within 1 second while following; scrolling up pauses following and a control resumes it."
  - "Filters and search apply to the full log, not only the loaded window."
  - "A 20,000-line log scrolls smoothly and Download returns the complete file."
  - "Colours meet 4.5:1 contrast in dark and light themes."
description: "The Log tab shows exactly what the terminal shows for the run, streamed from the log tail route. Controls: follow tail (on by default, turns off when the operator scrolls up, back on at the bottom), timestamps on or off, a filter (everything, tool calls, tests, errors and retries, model turns), search within the log, jump to turn, and Download .log. A line above the log names the command that started the run and the line count; turn separators and colour classes distinguish model turns, tools and tests, errors, and hench retries and gates, with a legend. Render large logs without freezing the page (window the lines rather than putting thousands of nodes in the DOM)."
lastModified: "2026-10-01T05:54:49.512Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
