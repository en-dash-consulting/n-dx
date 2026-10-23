---
id: "fa572435-b461-4086-b370-97cfb9edd2b6"
type: "change"
title: "Surface commit attribution in dashboard PRD detail view and folder index summaries"
slug: "surface-commit-attribution-in"
intent: "Display the `commits` array in the dashboard PRD detail panel (with author, short-hash, link to remote, timestamp) and feed the same data into the folder-level `index.md` per-task commit list. Ensure the rendering is consistent across both surfaces and degrades gracefully when no commits are recorded."
acceptanceCriteria:
  - "Detail panel shows a commits table with author, short hash (linked to remote when configured), full hash on hover, and timestamp"
  - "`index.md` summary's per-task commit section consumes the same data source"
  - "Empty `commits` arrays render an explicit 'no commits recorded' state, not a broken table"
  - "Visual regression coverage for the new commits table"
  - "End-to-end test: complete a task, refresh dashboard, assert commit appears in both detail panel and parent folder index.md"
touches:
  - "78798ece-882f-44c9-9996-6eec6e909989"
priority: "medium"
tags:
  - "web"
  - "ui"
  - "prd"
source: "smart-add"
---
