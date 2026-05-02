---
id: "ed1f0944-536d-44a4-ad18-d2f3e4827e16"
level: "feature"
title: "Codex Multi-line Token Count Parsing Fix"
status: "completed"
source: "smart-add"
startedAt: "2026-04-14T20:50:00.776Z"
completedAt: "2026-04-14T20:50:00.776Z"
acceptanceCriteria: []
description: "Codex CLI emits token usage across two lines: the label 'tokens used' on one line and the numeric count on the immediately following line. The current parser does not capture this two-line pattern, so Codex credit consumption goes unrecorded in run summaries and budget tracking."
---

# Codex Multi-line Token Count Parsing Fix

 [completed]

## Summary

Codex CLI emits token usage across two lines: the label 'tokens used' on one line and the numeric count on the immediately following line. The current parser does not capture this two-line pattern, so Codex credit consumption goes unrecorded in run summaries and budget tracking.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Fix Codex output parser to capture next-line token count after 'tokens used' label | task | completed | 2026-04-16 |

## Info

- **Status:** completed
- **Level:** feature
- **Started:** 2026-04-14T20:50:00.776Z
- **Completed:** 2026-04-14T20:50:00.776Z
- **Duration:** < 1m
