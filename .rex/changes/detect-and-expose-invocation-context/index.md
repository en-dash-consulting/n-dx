---
id: "8f811dac-e4f2-4e47-84ea-8c425a1d6328"
type: "change"
title: "Detect and expose invocation context in hench runner"
slug: "detect-and-expose-invocation-context"
intent: "Modify hench entry points to detect the invocation method (CLI vs API) at run initialization. Add context information to the execution output stream and run metadata so users can clearly see which interface triggered the agent execution."
acceptanceCriteria:
  - "Hench detects CLI vs HTTP/API invocation context at run start"
  - "Context flag is stored in run metadata and persisted in .hench/runs/"
  - "Context is emitted in the output stream so both CLI and dashboard receive it"
  - "Detection works correctly for all hench invocation paths (ndx work CLI, web HTTP, MCP)"
touches:
  - "28bd8b48-2012-42dd-9148-d844a082cb8b"
priority: "medium"
tags:
  - "hench"
  - "visibility"
  - "logging"
source: "smart-add"
---
