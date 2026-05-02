---
id: "0b9042e1-523e-4fab-aca4-1d89bbb0c6f3"
level: "task"
title: "Fix rolling window to count visual lines instead of message entries"
status: "completed"
priority: "high"
tags:
  - "hench"
  - "cli"
  - "output"
  - "bugfix"
source: "smart-add"
startedAt: "2026-04-09T13:55:23.150Z"
completedAt: "2026-04-09T13:58:42.608Z"
acceptanceCriteria:
  - "A message containing N embedded newlines counts as N+1 lines toward the 10-line cap"
  - "The visible output region never exceeds 10 lines when any combination of single- and multi-line messages is present"
  - "Single-line-only runs behave identically to before the fix"
  - "A multi-line tool response that alone exceeds 10 lines is truncated or capped so the window stays within bounds"
  - "The ANSI cursor-reposition logic correctly erases the prior frame before redrawing when multi-line messages change the row count"
description: "The current rolling 10-line window tracks the number of messages rather than the number of rendered lines. When a single message contains embedded newlines (e.g. tool output, JSON blocks, multi-line agent responses), each message may occupy 2–10+ terminal rows, causing the scroll region to overflow well beyond 10 visible lines. The fix must split each queued message on newlines before counting, so the window always displays at most 10 terminal rows regardless of message structure."
---

# Fix rolling window to count visual lines instead of message entries

🟠 [completed]

## Summary

The current rolling 10-line window tracks the number of messages rather than the number of rendered lines. When a single message contains embedded newlines (e.g. tool output, JSON blocks, multi-line agent responses), each message may occupy 2–10+ terminal rows, causing the scroll region to overflow well beyond 10 visible lines. The fix must split each queued message on newlines before counting, so the window always displays at most 10 terminal rows regardless of message structure.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** hench, cli, output, bugfix
- **Level:** task
- **Started:** 2026-04-09T13:55:23.150Z
- **Completed:** 2026-04-09T13:58:42.608Z
- **Duration:** 3m
