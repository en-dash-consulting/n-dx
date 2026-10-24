---
id: "d5c544d1-8ba7-4ef2-93e8-cfc0c45d2e43"
type: "task"
title: "Finish the errorMessage sweep across the dashboard routes"
slug: "finish-the-errormessage-sweep-across"
description: "Layer 8 of the CodeQL stack (docs/process/codeql-triage-2026-10.md, Layer 8). CodeQL alert 36 (js/stack-trace-exposure) at response-utils.ts line 34, the shared jsonResponse sink, so one alert aggregates every route. Nothing reads .stack; the flows are String(err) from a catch, which on an Error is name: message, never the stack, so substantively a false positive. Commit 23a99bc06 already added errorMessage() in response-utils.ts for this alert and used it in one route. Finish the sweep: about 25 direct errorResponse(res, N, String(err)) sites and about 20 instanceof-ternaries across routes-commands, routes-rex-analysis, routes-rex/*, routes-adaptive, routes-git, routes-hench, routes-iso-map, routes-sourcevision, routes-workflow, routes-llm and routes-hench-prep, plus the served status fields (selfHealStatus.error, slot.state.error, outcome.error). Add a policy test that fails any errorResponse or jsonResponse call whose argument is String(err). Last in the stack because it touches the most files. Branch fix/web-error-message-sweep."
acceptanceCriteria:
  - "No errorResponse or jsonResponse call under packages/web/src/server passes String(err) or an instanceof-Error ternary; a policy test enforces it"
  - "errorMessage returns the message of an Error and a fixed Unexpected error for a non-Error, with a unit test"
  - "Patch changeset for @n-dx/web"
priority: "low"
source: "codeql-triage"
---
