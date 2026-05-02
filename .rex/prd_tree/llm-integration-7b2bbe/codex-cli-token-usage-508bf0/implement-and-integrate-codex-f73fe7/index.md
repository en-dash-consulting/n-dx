---
id: "f73fe756-18f6-40fd-bdee-0001e40795ed"
level: "task"
title: "Implement and integrate Codex CLI token usage extraction into hench run tracking"
status: "completed"
priority: "high"
tags:
  - "codex"
  - "token-tracking"
  - "hench"
source: "smart-add"
startedAt: "2026-04-14T20:05:41.978Z"
completedAt: "2026-04-14T20:10:12.418Z"
acceptanceCriteria:
  - "Parser correctly extracts input and output token counts from the Codex CLI output format and returns null when no token usage line is present"
  - "Handles edge cases: multiple token lines (uses last occurrence), partial output, and non-numeric tokens"
  - "Token counts are recorded as a token event in the hench run log with the correct vendor and model fields"
  - "Recorded events appear in ndx usage output under the codex vendor bucket, matching the same aggregation path as Claude events"
  - "When Codex output contains no token line, no token event is written to the run log"
  - "Unit tests cover the standard format, absent token line, malformed numbers, and multi-line output variants"
  - "Integration test drives a mock Codex run with a known token line in stdout and asserts the resulting run log entry contains the expected token counts"
description: "Codex CLI outputs a token usage summary line after each run (e.g. 'Tokens used: 1234 in, 567 out'). Implement a pure parser that scans the captured stdout/stderr buffer for this pattern, extracts input and output token counts, and returns a structured object compatible with the existing unified token metrics schema. After the Codex process exits, pass the extracted counts into the existing hench token event recording pipeline, stamped with vendor='codex' and the resolved model name so they roll up correctly into per-task usage chips, the weekly budget calculator, and the dashboard's vendor-grouped utilization view. When no token line is present in the output, no event should be emitted."
---

# Implement and integrate Codex CLI token usage extraction into hench run tracking

🟠 [completed]

## Summary

Codex CLI outputs a token usage summary line after each run (e.g. 'Tokens used: 1234 in, 567 out'). Implement a pure parser that scans the captured stdout/stderr buffer for this pattern, extracts input and output token counts, and returns a structured object compatible with the existing unified token metrics schema. After the Codex process exits, pass the extracted counts into the existing hench token event recording pipeline, stamped with vendor='codex' and the resolved model name so they roll up correctly into per-task usage chips, the weekly budget calculator, and the dashboard's vendor-grouped utilization view. When no token line is present in the output, no event should be emitted.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** codex, token-tracking, hench
- **Level:** task
- **Started:** 2026-04-14T20:05:41.978Z
- **Completed:** 2026-04-14T20:10:12.418Z
- **Duration:** 4m
