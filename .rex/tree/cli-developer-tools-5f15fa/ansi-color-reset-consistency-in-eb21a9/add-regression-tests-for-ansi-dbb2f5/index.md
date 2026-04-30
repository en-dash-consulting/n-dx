---
id: "dbb2f5ef-4e60-431a-9e9f-8ade8f2eba28"
level: "task"
title: "Add regression tests for ANSI color reset and line-boundary consistency"
status: "completed"
priority: "medium"
tags:
  - "cli"
  - "ansi"
  - "color"
  - "test"
source: "smart-add"
startedAt: "2026-04-09T18:14:03.723Z"
completedAt: "2026-04-09T18:32:06.024Z"
acceptanceCriteria:
  - "Unit tests assert that every string returned by the color utility ends with the ANSI reset sequence"
  - "At least one integration-level test per CLI tool verifies no color bleed across output lines in TTY mode"
  - "Tests fail if a colorized string is returned without a trailing reset"
  - "NO_COLOR and non-TTY paths are also covered (no ANSI codes emitted at all)"
description: "Add targeted tests that assert colorized CLI output strings always contain a reset code at the end of each colored segment. Tests should cover the shared color utility and at least one representative output path from each CLI tool (rex, hench, sourcevision). Prevents future contributors from reintroducing missing resets when adding new color usage."
---

# Add regression tests for ANSI color reset and line-boundary consistency

🟡 [completed]

## Summary

Add targeted tests that assert colorized CLI output strings always contain a reset code at the end of each colored segment. Tests should cover the shared color utility and at least one representative output path from each CLI tool (rex, hench, sourcevision). Prevents future contributors from reintroducing missing resets when adding new color usage.

## Info

- **Status:** completed
- **Priority:** medium
- **Tags:** cli, ansi, color, test
- **Level:** task
- **Started:** 2026-04-09T18:14:03.723Z
- **Completed:** 2026-04-09T18:32:06.024Z
- **Duration:** 18m
