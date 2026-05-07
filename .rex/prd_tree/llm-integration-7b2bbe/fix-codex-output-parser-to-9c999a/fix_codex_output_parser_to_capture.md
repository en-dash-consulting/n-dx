---
id: "9c999a92-f89f-469c-a527-5e4aaae920bf"
level: "task"
title: "Fix Codex output parser to capture next-line token count after 'tokens used' label"
status: "completed"
priority: "high"
tags:
  - "codex"
  - "token-usage"
  - "parser"
source: "smart-add"
startedAt: "2026-04-14T20:49:56.016Z"
completedAt: "2026-04-16T21:15:25.839Z"
acceptanceCriteria:
  - "Parser correctly extracts the integer token count when it appears on the line immediately after 'tokens used'"
  - "Parser also handles any pre-existing same-line pattern without regression"
  - "Extracted token count is stored and surfaced in hench run summary output"
  - "Extracted token count is recorded in the run log and propagated to token usage aggregation"
description: "The existing Codex token extraction logic looks for a token count on the same line as the 'tokens used' marker. Codex actually prints 'tokens used' as a standalone label and puts the integer count on the line immediately following it. Update the parser to handle this two-line pattern: detect the 'tokens used' sentinel, then read the next non-empty line as the count. The fix should be backward-compatible in case future Codex versions collapse this back to one line."
__parentAcceptanceCriteria: []
__parentCompletedAt: "2026-04-14T20:50:00.776Z"
__parentDescription: "Codex CLI emits token usage across two lines: the label 'tokens used' on one line and the numeric count on the immediately following line. The current parser does not capture this two-line pattern, so Codex credit consumption goes unrecorded in run summaries and budget tracking."
__parentId: "ed1f0944-536d-44a4-ad18-d2f3e4827e16"
__parentLevel: "feature"
__parentSource: "smart-add"
__parentStartedAt: "2026-04-14T20:50:00.776Z"
__parentStatus: "completed"
__parentTitle: "Codex Multi-line Token Count Parsing Fix"
---
