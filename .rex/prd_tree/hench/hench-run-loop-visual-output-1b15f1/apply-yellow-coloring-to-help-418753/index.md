---
id: "418753a7-1d86-446e-a5c7-aeedc63b1ec1"
level: "task"
title: "Apply yellow coloring to help notes and warning messages in hench CLI output"
status: "completed"
priority: "medium"
tags:
  - "hench"
  - "cli"
  - "color"
  - "ux"
source: "smart-add"
startedAt: "2026-04-08T23:08:34.229Z"
completedAt: "2026-04-08T23:20:47.434Z"
acceptanceCriteria:
  - "Help notes (guidance hints, usage prompts) render in yellow when stdout is a TTY"
  - "Warning messages render in yellow when stdout is a TTY"
  - "Yellow is applied via the existing colorWarn semantic helper — no ad-hoc ANSI codes"
  - "No color is emitted when NO_COLOR is set or stdout is not a TTY"
  - "At least one hench command (e.g. hench run with an out-of-quota warning) demonstrates the colored output in a manual smoke test"
description: "Help notes (usage hints, guidance prompts) and warning messages emitted by hench should render in yellow to signal caution or informational guidance without alarming the user. This aligns these message categories with the established semantic convention where yellow (colorWarn) represents advisory information, making them visually distinct from success (green) and error (red) output."
---

# Apply yellow coloring to help notes and warning messages in hench CLI output

🟡 [completed]

## Summary

Help notes (usage hints, guidance prompts) and warning messages emitted by hench should render in yellow to signal caution or informational guidance without alarming the user. This aligns these message categories with the established semantic convention where yellow (colorWarn) represents advisory information, making them visually distinct from success (green) and error (red) output.

## Info

- **Status:** completed
- **Priority:** medium
- **Tags:** hench, cli, color, ux
- **Level:** task
- **Started:** 2026-04-08T23:08:34.229Z
- **Completed:** 2026-04-08T23:20:47.434Z
- **Duration:** 12m
