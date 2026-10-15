---
id: "311a52a4-60bc-4265-a65b-2b94cd946d25"
level: "task"
title: "A full-screen tile splits with the open PRD item as a sidebar"
status: "completed"
priority: "medium"
tags:
  - "web"
  - "viewer"
  - "ui"
  - "dashboard"
  - "prd"
blockedBy:
  - "cccbd450-bb82-4245-a054-50fc6dc07874"
source: "ndx-capture"
startedAt: "2026-10-15T04:22:25.783Z"
completedAt: "2026-10-15T04:28:32.331Z"
endedAt: "2026-10-15T04:28:32.331Z"
resolutionType: "code-change"
resolutionDetail: "Full-screen tile leaves room for the open detail panel"
acceptanceCriteria:
  - "With a PRD item detail open, a full-screen tile shows its view and the item detail side by side."
  - "Closing the sidebar returns the view to full width; closing full-screen leaves the item detail state as it was."
  - "At narrow widths the sidebar stacks below or overlays the view instead of squeezing it."
description: "When a tile is full-screen and a PRD item detail is open (e.g. after choosing a related task), the full-screen view splits: the tile's view on the left, the PRD item detail as a right sidebar, closable independently."
lastModified: "2026-10-15T04:28:33.217Z"
lastModifiedBy: "Nick Daniel <nick@endash.us>"
---
