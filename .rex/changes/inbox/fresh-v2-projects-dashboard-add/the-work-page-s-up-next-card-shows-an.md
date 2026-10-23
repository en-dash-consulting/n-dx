---
id: "fdeb0c2c-d796-403f-b43d-63885c61a085"
type: "task"
title: "The Work page's Up Next card shows an empty id slot for an Inbox change"
slug: "the-work-page-s-up-next-card-shows-an"
description: "The Up Next card header shows the status dot, then a separator and an empty slot where the display id goes, then the priority (for example '○ · Medium'). An Inbox change has no display id, so the slot is blank. With no priority set, the header reads '○ —', which looks like a missing title. Show the change's type or 'Inbox' there, or leave the slot out."
acceptanceCriteria:
  - "An Inbox change in Up Next shows no empty separator or dash where an id would go"
  - "A placed change and a v1 task still show their id"
  - "A viewer test covers an Inbox change, a placed change and a v1 task"
priority: "medium"
tags:
  - "0.10.0"
  - "v2"
  - "fresh-project"
  - "dashboard"
  - "web"
source: "ndx-capture"
---
