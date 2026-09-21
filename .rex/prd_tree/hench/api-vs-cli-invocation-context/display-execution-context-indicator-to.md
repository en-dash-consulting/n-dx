---
id: "eab9294a-7201-4d16-9031-fda6a89618aa"
level: "task"
title: "Display execution context indicator to users in CLI and dashboard"
status: "completed"
priority: "medium"
tags:
  - "hench"
  - "cli"
  - "dashboard"
  - "ux"
source: "smart-add"
startedAt: "2026-04-20T18:37:35.481Z"
completedAt: "2026-04-20T18:43:09.749Z"
resolutionType: "code-change"
resolutionDetail: "Implemented invocation context display in CLI output and dashboard. Added context indicator to run completion output, API responses, and dashboard UI with appropriate styling."
acceptanceCriteria:
  - "CLI output shows execution context indicator (e.g., badge or message at run start)"
  - "Dashboard run viewer displays context in the run header or metadata panel"
  - "Context is preserved in run transcripts for audit and historical review"
  - "Both CLI and dashboard clearly communicate whether the run was triggered via CLI or API"
description: "Surface the invocation context visibly in CLI output when running ndx work, and in the web dashboard when viewing runs. Include the context indicator in run history, active run displays, and real-time output streams."
---
