---
id: "a286684b-1607-4911-8ab7-101f7f19d110"
type: "change"
title: "Dashboard pages scroll sideways at phone width"
slug: "dashboard-pages-scroll-sideways-at"
summary: "On a phone-width screen, several dashboard pages can be dragged sideways by about a finger's width because the bottom bar and the Live link stick out past the edge. Fixing it makes the dashboard usable on small screens."
intent: "Found while measuring tile spacing (change 064dd7fc) with Playwright: at 390px wide, some stage pages scroll horizontally by about 56px. The overflowing elements are `.bottombar-controls` and `.topnav-live` (once also `.mg-header-right`), not tiles; at that width the tile grid is already one column. The result varied between runs. It predates the spacing change, but no baseline run without the change was made, so confirm on main first."
acceptanceCriteria:
  - "At 390px wide, no stage page (Analysis, Plan, Work, Tune, Live) scrolls horizontally"
  - "The bottom bar controls and the Live link stay fully visible and usable at 390px, wrapping or collapsing rather than overflowing"
  - "An automated check (unit or Playwright) fails if any stage page's document is wider than a 390px viewport"
touches:
  - "d5ad6f16-156d-496f-99e5-0230dd48cd47"
priority: "medium"
discoveredFrom: {"item":"064dd7fc-e4e9-4314-ab8b-6e9399485dc7"}
tags:
  - "web"
  - "css"
  - "responsive"
source: "ndx-capture"
---
