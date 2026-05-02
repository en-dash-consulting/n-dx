---
id: "5f17b7af-ba00-43a6-8c6c-dcd5c8bf1d00"
level: "task"
title: "Audit and fix missing ANSI reset codes in tool and CLI output lines"
status: "completed"
priority: "high"
tags:
  - "cli"
  - "ansi"
  - "color"
  - "bug"
source: "smart-add"
startedAt: "2026-04-09T17:59:32.893Z"
completedAt: "2026-04-09T18:13:00.000Z"
acceptanceCriteria:
  - "No terminal line colored blue (or any other ANSI color) bleeds color onto the next output line"
  - "All colorized output strings end with the ANSI reset sequence"
  - "Color formatting utility enforces reset-on-close so callers cannot emit a color without a paired reset"
  - "Verified across rex, hench, sourcevision, and ndx orchestrator output paths"
description: "Identify all call sites in the CLI output pipeline where blue (and other) ANSI color codes are applied without a trailing reset sequence. The primary symptom is that text after a colored tool-output line inherits the blue color. Fix each site to ensure every colorized string ends with the ANSI reset code (`\\x1b[0m`), including multi-line and wrapped tool output. Cover rex, hench, sourcevision, and the ndx orchestrator."
---

# Audit and fix missing ANSI reset codes in tool and CLI output lines

🟠 [completed]

## Summary

Identify all call sites in the CLI output pipeline where blue (and other) ANSI color codes are applied without a trailing reset sequence. The primary symptom is that text after a colored tool-output line inherits the blue color. Fix each site to ensure every colorized string ends with the ANSI reset code (`\x1b[0m`), including multi-line and wrapped tool output. Cover rex, hench, sourcevision, and the ndx orchestrator.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** cli, ansi, color, bug
- **Level:** task
- **Started:** 2026-04-09T17:59:32.893Z
- **Completed:** 2026-04-09T18:13:00.000Z
- **Duration:** 13m
