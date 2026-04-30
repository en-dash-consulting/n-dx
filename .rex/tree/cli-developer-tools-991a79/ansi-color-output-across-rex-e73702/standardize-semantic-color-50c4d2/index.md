---
id: "50c4d2b6-d8e8-49dd-9c8a-ee66b0f9b89d"
level: "task"
title: "Standardize semantic color conventions for status and log-level output across all CLI tools"
status: "completed"
priority: "medium"
tags:
  - "cli"
  - "ux"
  - "color"
source: "smart-add"
startedAt: "2026-04-08T20:57:32.922Z"
completedAt: "2026-04-08T21:08:10.700Z"
acceptanceCriteria:
  - "A STATUS_COLORS or equivalent map is defined in the shared ANSI utility, mapping PRD status values and log levels to specific ANSI color codes"
  - "Rex, sourcevision, hench, and ndx orchestrator all use the same color for the same logical state (e.g. every 'completed' label is green regardless of which tool emits it)"
  - "Error lines across all tools share one color; info, success, and warning lines are each visually distinct and consistent"
  - "The color convention is documented with a code comment or a brief entry in CODEX.md"
description: "Define a shared color vocabulary in the ANSI utility (e.g. green=completed/success, yellow=pending/warning, red=error/failed, cyan=info) and apply it consistently to every status badge, result summary line, and log-level label produced by rex, sourcevision, hench, and the ndx orchestrator. Without a shared convention, color is cosmetic rather than meaningful — the goal is that a user can parse the semantic state of output from any tool by color alone."
---

# Standardize semantic color conventions for status and log-level output across all CLI tools

🟡 [completed]

## Summary

Define a shared color vocabulary in the ANSI utility (e.g. green=completed/success, yellow=pending/warning, red=error/failed, cyan=info) and apply it consistently to every status badge, result summary line, and log-level label produced by rex, sourcevision, hench, and the ndx orchestrator. Without a shared convention, color is cosmetic rather than meaningful — the goal is that a user can parse the semantic state of output from any tool by color alone.

## Info

- **Status:** completed
- **Priority:** medium
- **Tags:** cli, ux, color
- **Level:** task
- **Started:** 2026-04-08T20:57:32.922Z
- **Completed:** 2026-04-08T21:08:10.700Z
- **Duration:** 10m
