---
id: "28bd8b48-2012-42dd-9148-d844a082cb8b"
type: "capability"
title: "API vs CLI Invocation Context Detection and Display"
slug: "api-vs-cli-invocation-context"
statement: "Hench detects whether a run was triggered through the CLI (ndx work), the web HTTP API or MCP, records that invocation context with the run and shows it to users in CLI output, the dashboard and run transcripts."
criteria: [{"id":"c1","text":"When a run starts, hench shall detect whether it was invoked through the CLI or through the HTTP API."},{"id":"c2","text":"Hench shall detect the invocation context correctly for every invocation path: the ndx work CLI, the web HTTP API and MCP."},{"id":"c3","text":"Hench shall store the invocation context in the run metadata it saves under .hench/runs/."},{"id":"c4","text":"Hench shall emit the invocation context in the run's output stream, so both the CLI and the dashboard receive it."},{"id":"c5","text":"When a run starts under ndx work, the CLI shall print an indicator of the execution context."},{"id":"c6","text":"The dashboard run viewer shall display the execution context in the run header or metadata panel."},{"id":"c7","text":"Hench shall keep the execution context in run transcripts so it is available for audit and later review."},{"id":"c8","text":"The CLI and the dashboard shall each show whether a run was triggered through the CLI or through the API."}]
source: "smart-add"
---

Detect whether hench is being invoked through the CLI (ndx work command) or via HTTP API/MCP and surface this context to the user through output messages, flags, and run metadata.
