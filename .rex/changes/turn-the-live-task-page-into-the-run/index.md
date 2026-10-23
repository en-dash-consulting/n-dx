---
id: "304ab89a-7e51-4b25-b25d-000b9ed28526"
type: "change"
title: "Turn the Live task page into the run summary when the run finishes"
slug: "turn-the-live-task-page-into-the-run"
intent: "At the same `/live/task/:taskId` URL, once the selected run has finished: the work summary (`structuredSummary`) and review findings with what was fixed and captured, then run metrics (wall time, turns, retries, tool calls, tokens by class, estimated cost, files changed, commit), with the run picker for tasks that ran more than once. Actions: Re-run, Open commit, Capture follow-up to the PRD. All of this is on `GET /api/hench/runs/:id` today. The Work, Log and Review tabs stay available for the finished run."
acceptanceCriteria:
  - "A finished run's page shows the summary and metrics from the existing run route, with no new server data."
  - "The Work, Log and Review tabs still open for the finished run."
  - "Re-run starts the task again and the page switches to the new run."
touches:
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
priority: "low"
tags:
  - "live"
  - "web-viewer"
  - "deferred"
blockedBy:
  - "8050220c-7add-4547-8806-0fc6765acb82"
---
