---
id: "f3c00d88-b7e7-4577-8535-fa645bfa291e"
type: "change"
title: "Analyze tiles show a purpose-built summary before they are expanded"
slug: "analyze-tiles-show-a-purpose-built"
intent: "Each Analyze tile's collapsed body is a compact summary built from data already loaded, not the clipped view: Problems and Suggestions (counts by severity, top three), Next steps (count by priority, top three), Zones (count, largest zones, partition health line), Files (totals by role/language), Architecture (patterns/routes counts), languages (the bar chart). Summaries need no extra fetch."
acceptanceCriteria:
  - "Every Analyze tile has a collapsed summary that fits its tile without scrolling."
  - "Summaries read from the already-loaded analysis data and start no request of their own."
  - "A tile with nothing to show (no findings, no routes) says so in one line rather than rendering empty."
priority: "medium"
tags:
  - "web"
  - "viewer"
  - "ui"
  - "dashboard"
source: "ndx-capture"
blockedBy:
  - "cccbd450-bb82-4245-a054-50fc6dc07874"
---
