---
id: "1ccc2ffe-076b-4209-8ebb-ccf1ac871a44"
level: "task"
title: "Apply ANSI color-coding and in-progress markers to `ndx tree` output"
status: "completed"
priority: "high"
tags:
  - "cli"
  - "ansi"
  - "prd"
source: "smart-add"
startedAt: "2026-05-08T00:48:36.309Z"
completedAt: "2026-05-08T01:04:03.074Z"
endedAt: "2026-05-08T01:04:03.074Z"
resolutionType: "code-change"
resolutionDetail: "Implemented rex tree command with ANSI color-coding: completed items in magenta, in-progress items in yellow with ** markers, pending items in neutral. Colors respect NO_COLOR env and non-TTY detection. All colors sourced from @n-dx/llm-client. Tree renders full PRD hierarchy with status icons, progress bars for epics, priorities, timestamps, and metadata. Created tree.ts command handler, updated status-shared.ts to export helper functions, registered command in CLI dispatch and help text. Added 6 tests covering colors, NO_COLOR behavior, deleted item filtering. All tests pass. Committed to feature branch."
acceptanceCriteria:
  - "Completed items are rendered with purple ANSI color applied to the full title line"
  - "In-progress items are rendered in yellow with `**` prepended and appended to the title"
  - "Pending items are rendered without any ANSI codes"
  - "When `NO_COLOR` is set or stdout is not a TTY, all ANSI sequences are stripped and `**` markers are still present for in-progress items"
  - "Color constants are sourced from the shared ANSI color utility — no inline color codes"
description: "Extend the tree command output with the specified color scheme: completed items in purple, in-progress items in yellow with `**title**` surrounding asterisks, and pending items with no color. Must reuse the shared ANSI color utility already used across other CLI commands and must respect `NO_COLOR` and non-TTY detection."
---
