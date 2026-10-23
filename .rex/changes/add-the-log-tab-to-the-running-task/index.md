---
id: "c1874b13-d3ac-402a-93ac-fe49c773c37b"
type: "change"
title: "Add the Log tab to the running-task page: the raw terminal stream with follow, filter and search"
slug: "add-the-log-tab-to-the-running-task"
intent: "The Log tab shows exactly what the terminal shows for the run, streamed from the log tail route. Controls: follow tail (on by default, turns off when the operator scrolls up, back on at the bottom), timestamps on or off, a filter (everything, tool calls, tests, errors and retries, model turns), search within the log, jump to turn, and Download .log. A line above the log names the command that started the run and the line count; turn separators and colour classes distinguish model turns, tools and tests, errors, and hench retries and gates, with a legend. Render large logs without freezing the page (window the lines rather than putting thousands of nodes in the DOM)."
acceptanceCriteria:
  - "New lines appear within 1 second while following; scrolling up pauses following and a control resumes it."
  - "Filters and search apply to the full log, not only the loaded window."
  - "A 20,000-line log scrolls smoothly and Download returns the complete file."
  - "Colours meet 4.5:1 contrast in dark and light themes."
amends: [{"target":"ba50eaa7-5f31-4a8d-9e16-6c452882022e","delta":"modified","summary":"Add the Log tab to the running-task page: the raw terminal stream with follow, filter and search","base":"47ca7191923435e9fb69c02bec975969b6bd32b464697a3abcf08bc2db752efc"}]
priority: "medium"
tags:
  - "live"
  - "web-viewer"
blockedBy:
  - "8050220c-7add-4547-8806-0fc6765acb82"
  - "b1dd0bde-32a5-418c-a046-917e7d407181"
---
