---
id: "1ccc2ffe-076b-4209-8ebb-ccf1ac871a44"
type: "change"
title: "Apply ANSI color-coding and in-progress markers to `ndx tree` output"
slug: "apply-ansi-color-coding-and-in"
intent: "Extend the tree command output with the specified color scheme: completed items in purple, in-progress items in yellow with `**title**` surrounding asterisks, and pending items with no color. Must reuse the shared ANSI color utility already used across other CLI commands and must respect `NO_COLOR` and non-TTY detection."
acceptanceCriteria:
  - "Completed items are rendered with purple ANSI color applied to the full title line"
  - "In-progress items are rendered in yellow with `**` prepended and appended to the title"
  - "Pending items are rendered without any ANSI codes"
  - "When `NO_COLOR` is set or stdout is not a TTY, all ANSI sequences are stripped and `**` markers are still present for in-progress items"
  - "Color constants are sourced from the shared ANSI color utility — no inline color codes"
touches:
  - "13d17a1e-7203-4afd-b082-64b32742dead"
priority: "high"
tags:
  - "cli"
  - "ansi"
  - "prd"
source: "smart-add"
---
