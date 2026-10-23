---
id: "e1355780-c0e5-40a1-8b34-cd6abce2f884"
type: "change"
title: "Languages tile opens to a full breakdown, and languages get their own colours"
slug: "languages-tile-opens-to-a-full"
intent: "User (2026-10-15): \"Languages tile is busted\" — opened, it shows the same five-bar chart in an otherwise empty full modal, and C#, ASP.NET and SQL fall back to the same accent green. Opened, the panel should be a full breakdown: every inventoried language with files, lines, share, and whether its imports are analysed (summary.analysedLanguages), plus skipped extensions. Collapsed, the top languages as bars. Add colours for C#, ASP.NET, SQL and other common languages."
acceptanceCriteria:
  - "Opened, the Languages tile shows every inventoried language with file count, line count, share of files, and whether its imports are analysed, plus the skipped extensions."
  - "Collapsed, the tile shows the top languages as bars."
  - "C#, ASP.NET and SQL each draw in a distinct colour."
priority: "medium"
tags:
  - "web"
  - "viewer"
  - "ui"
  - "dashboard"
source: "ndx-capture"
---
