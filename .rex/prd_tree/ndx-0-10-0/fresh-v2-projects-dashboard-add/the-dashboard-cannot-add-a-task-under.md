---
id: "4e91343d-e1bc-449a-8a85-40d4d7fae389"
level: "task"
title: "The dashboard cannot add a task under a v2 change"
status: "pending"
priority: "high"
tags:
  - "0.10.0"
  - "v2"
  - "fresh-project"
  - "dashboard"
  - "web"
source: "ndx-capture"
acceptanceCriteria:
  - "From a change's detail panel, a user can add a task with a title, description, criteria and priority, and it is written under that change on v2"
  - "The add action offered on a change names a task, never a feature or an epic"
  - "Route tests cover adding a task under an Inbox change and under a placed change"
description: "POST /api/rex/items with a change as parent is refused: 'Quick Add does not add a task under a change. Use Add with no parent for an Inbox change, or `rex add --type=task --parent=<id>` (or MCP add_item).' A fresh v2 project run from the dashboard is therefore left with changes that have no tasks, which is what produces the 0/0 progress. The CLI and MCP can already add a task under a change."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-22T17:14:32.504Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
