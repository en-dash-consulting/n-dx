---
id: "eab9294a-7201-4d16-9031-fda6a89618aa"
type: "change"
title: "Display execution context indicator to users in CLI and dashboard"
slug: "display-execution-context-indicator-to"
intent: "Surface the invocation context visibly in CLI output when running ndx work, and in the web dashboard when viewing runs. Include the context indicator in run history, active run displays, and real-time output streams."
acceptanceCriteria:
  - "CLI output shows execution context indicator (e.g., badge or message at run start)"
  - "Dashboard run viewer displays context in the run header or metadata panel"
  - "Context is preserved in run transcripts for audit and historical review"
  - "Both CLI and dashboard clearly communicate whether the run was triggered via CLI or API"
touches:
  - "28bd8b48-2012-42dd-9148-d844a082cb8b"
priority: "medium"
tags:
  - "hench"
  - "cli"
  - "dashboard"
  - "ux"
source: "smart-add"
---
