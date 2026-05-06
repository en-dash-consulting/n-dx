---
id: "4fbde3c0-c586-45c1-9309-fab162520b05"
level: "task"
title: "Implement ANSI color-coded quota log formatter"
status: "completed"
priority: "medium"
tags:
  - "llm"
  - "quota"
  - "cli"
  - "hench"
source: "smart-add"
startedAt: "2026-04-08T18:00:30.436Z"
completedAt: "2026-04-08T18:03:00.004Z"
acceptanceCriteria:
  - "Text is rendered yellow (ANSI 33) when percent remaining is >= 5% and < 10%"
  - "Text is rendered red (ANSI 31) when percent remaining is < 5%"
  - "Text uses default terminal color when percent remaining is >= 10%"
  - "Formatter returns empty output (empty string or empty array) when the quota-remaining input is empty"
  - "Output format includes provider/model and percent value (e.g., 'Claude: 8% remaining')"
description: "Write a pure formatting function that accepts the typed quota-remaining array and returns a human-readable string (or array of strings) with ANSI color codes applied per threshold: red (ANSI 31) when percent remaining is below 5%, yellow (ANSI 33) when between 5% and 10%, and default terminal color otherwise. The formatter should return an empty result when the input array is empty so callers can skip output with a simple length check."
---

# Implement ANSI color-coded quota log formatter

🟡 [completed]

## Summary

Write a pure formatting function that accepts the typed quota-remaining array and returns a human-readable string (or array of strings) with ANSI color codes applied per threshold: red (ANSI 31) when percent remaining is below 5%, yellow (ANSI 33) when between 5% and 10%, and default terminal color otherwise. The formatter should return an empty result when the input array is empty so callers can skip output with a simple length check.

## Info

- **Status:** completed
- **Priority:** medium
- **Tags:** llm, quota, cli, hench
- **Level:** task
- **Started:** 2026-04-08T18:00:30.436Z
- **Completed:** 2026-04-08T18:03:00.004Z
- **Duration:** 2m
