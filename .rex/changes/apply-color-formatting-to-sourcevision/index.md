---
id: "51364a6f-bb3e-4b55-8523-ed490367ec37"
type: "change"
title: "Apply color formatting to sourcevision CLI output"
slug: "apply-color-formatting-to-sourcevision"
intent: "Wire the shared color utility into sourcevision command output so that analyze progress, zone detection results, findings by severity, and next-steps output use semantic colors. Finding severity levels (anti-pattern, pattern, suggestion, observation) should map to distinct colors. Analysis pass headers should be visually distinct from finding detail lines."
acceptanceCriteria:
  - "sourcevision analyze progress lines show phase headers in a distinct highlight color"
  - "Finding severity levels render with consistent colors: anti-pattern in red, pattern in yellow, suggestion in cyan, observation in dim"
  - "Zone summary output shows zone names and metrics with readable contrast"
  - "sourcevision validate pass/fail lines use green/red respectively"
  - "JSON and quiet output modes contain no ANSI escape codes"
  - "Colors are suppressed when stdout is not a TTY"
touches:
  - "c513f257-7f0b-4bce-9bf5-82f5cc909ef0"
priority: "high"
tags:
  - "sourcevision"
  - "cli"
  - "color"
source: "smart-add"
---
