---
id: "51364a6f-bb3e-4b55-8523-ed490367ec37"
level: "task"
title: "Apply color formatting to sourcevision CLI output"
status: "completed"
priority: "high"
tags:
  - "sourcevision"
  - "cli"
  - "color"
source: "smart-add"
startedAt: "2026-04-08T20:10:37.969Z"
completedAt: "2026-04-08T20:21:01.846Z"
acceptanceCriteria:
  - "sourcevision analyze progress lines show phase headers in a distinct highlight color"
  - "Finding severity levels render with consistent colors: anti-pattern in red, pattern in yellow, suggestion in cyan, observation in dim"
  - "Zone summary output shows zone names and metrics with readable contrast"
  - "sourcevision validate pass/fail lines use green/red respectively"
  - "JSON and quiet output modes contain no ANSI escape codes"
  - "Colors are suppressed when stdout is not a TTY"
description: "Wire the shared color utility into sourcevision command output so that analyze progress, zone detection results, findings by severity, and next-steps output use semantic colors. Finding severity levels (anti-pattern, pattern, suggestion, observation) should map to distinct colors. Analysis pass headers should be visually distinct from finding detail lines."
---
