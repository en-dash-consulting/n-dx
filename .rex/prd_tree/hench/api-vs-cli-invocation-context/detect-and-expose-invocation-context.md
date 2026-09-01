---
id: "8f811dac-e4f2-4e47-84ea-8c425a1d6328"
level: "task"
title: "Detect and expose invocation context in hench runner"
status: "completed"
priority: "medium"
tags:
  - "hench"
  - "visibility"
  - "logging"
source: "smart-add"
startedAt: "2026-04-20T18:27:53.277Z"
completedAt: "2026-04-20T18:37:20.851Z"
resolutionType: "code-change"
resolutionDetail: "Added invocationContext field to RunRecord to detect and expose whether hench is invoked via CLI (ndx work) or API (HTTP/MCP). The context is emitted via output stream and persisted in run metadata for both CLI and dashboard visibility."
acceptanceCriteria:
  - "Hench detects CLI vs HTTP/API invocation context at run start"
  - "Context flag is stored in run metadata and persisted in .hench/runs/"
  - "Context is emitted in the output stream so both CLI and dashboard receive it"
  - "Detection works correctly for all hench invocation paths (ndx work CLI, web HTTP, MCP)"
description: "Modify hench entry points to detect the invocation method (CLI vs API) at run initialization. Add context information to the execution output stream and run metadata so users can clearly see which interface triggered the agent execution."
---
