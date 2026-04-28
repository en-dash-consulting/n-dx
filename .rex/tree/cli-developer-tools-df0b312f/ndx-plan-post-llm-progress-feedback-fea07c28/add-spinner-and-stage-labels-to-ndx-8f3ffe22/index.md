---
id: "8f3ffe22-c031-4b7a-97e4-c4895439d6ea"
level: "task"
title: "Add spinner and stage labels to ndx plan output between LLM response and proposal display"
status: "completed"
priority: "high"
tags:
  - "cli"
  - "ndx-plan"
  - "dx"
  - "ux"
source: "smart-add"
startedAt: "2026-04-09T17:48:22.321Z"
completedAt: "2026-04-09T17:53:31.645Z"
acceptanceCriteria:
  - "A spinner or step label appears immediately after 'Done.' / 'Vendor: ...' with no perceptible gap"
  - "The indicator is cleared and replaced by the next substantive output line when proposals are ready"
  - "Running ndx plan in a TTY shows the spinner; piped/non-TTY output omits it"
  - "ndx plan --accept produces identical behavior with indicator present before proposal acceptance"
  - "No duplicate or garbled output when the indicator and proposal output overlap"
description: "Insert a progress indicator (spinner or step label) immediately after the 'Done.' / 'Vendor: ...' lines so users know the process is still active. The indicator should cover at minimum the proposal-building and proposal-display phases. It must be suppressed in --quiet / JSON modes and must not interfere with the existing 'Done.' and 'Vendor: ...' output."
---
