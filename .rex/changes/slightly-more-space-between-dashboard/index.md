---
id: "064dd7fc-e4e9-4314-ab8b-6e9399485dc7"
type: "change"
title: "Slightly more space between dashboard panes"
slug: "slightly-more-space-between-dashboard"
summary: "The dashboard's panels get a little more breathing room between them, so each panel reads as its own block."
intent: "Dashboard stage tiles sit close together: stage-tiles.css uses column-gap var(--space-4) and row-gap 0 (rows are a fine 4px track, so vertical spacing comes from track spans). Increase the gap between tiles one step, horizontally and vertically, on every stage (Analysis, Plan, Work, Tune, Live) and at every density setting, without making any page scroll sideways."
acceptanceCriteria:
  - "The horizontal gap between dashboard tiles is one spacing step larger than today"
  - "The vertical gap between tiles is visibly larger than today"
  - "The change applies on every stage page and at small, medium and large density"
  - "No stage page scrolls horizontally at the dashboard's supported widths after the change"
  - "Existing stage-tile layout tests pass, updated for the new spacing where they assert it"
touches:
  - "d5ad6f16-156d-496f-99e5-0230dd48cd47"
priority: "low"
tags:
  - "web"
  - "css"
  - "ux"
source: "ndx-capture"
---
