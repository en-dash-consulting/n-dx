---
id: "577c74cb-da15-4cb2-aca7-3012fe840896"
type: "capability"
title: "Item completion timeline view"
slug: "item-completion-timeline-view"
statement: "The Rex dashboard shows a completion timeline that lists completed PRD items with the most recent first, grouped by day and filterable by date range."
criteria: [{"id":"c1","text":"The timeline data source shall collect every PRD item that has a completedAt timestamp and return them sorted by completedAt, most recent first."},{"id":"c2","text":"If a PRD item has no completedAt timestamp, the timeline data source shall exclude it."},{"id":"c3","text":"The timeline data source shall include each entry's title, level, parent chain and completion timestamp."},{"id":"c4","text":"The timeline view shall group completed items by day."},{"id":"c5","text":"The timeline view shall show each entry's title, level badge, parent breadcrumb and completion time."},{"id":"c6","text":"The timeline view shall scroll and use virtual rendering for large completion histories."},{"id":"c7","text":"The Rex dashboard shall make the timeline view reachable from the Rex dashboard or as a tab on the Tasks page."},{"id":"c8","text":"The timeline view shall offer preset date range buttons for today, this week, this month and all time."},{"id":"c9","text":"When the timeline view first opens, the timeline view shall show completions from the last 7 days."},{"id":"c10","text":"The timeline view shall show the number of items in the selected date range."}]
tags:
  - "web"
  - "ux"
priority: "medium"
---

Add a timeline view to the Rex dashboard showing item completions over time. Users should see which items completed most recently, sorted by completedAt timestamp. This gives visibility into velocity and recent progress without digging through the tree.
