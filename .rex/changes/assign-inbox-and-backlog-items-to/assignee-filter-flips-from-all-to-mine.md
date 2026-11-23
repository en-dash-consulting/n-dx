---
id: "f38490c2-3ea9-48a2-84b0-84db958787e7"
type: "task"
title: "Assignee filter flips from All to Mine after rows render"
slug: "assignee-filter-flips-from-all-to-mine"
summary: "The Inbox first shows everyone's items and then jumps to only yours once it learns who you are, which can hide the item you were looking at. This waits until it knows before filtering."
description: "Verdict: should-fix (severity low, cheap), from the adversarial review of feat/assignee-picker-mine-filter.\n\nUntil /api/rex/people resolves, me is null, so the filter defaults to All with no Mine option; when the read lands it switches to Mine and rows collapse (components/assignee.ts:186-197, views/inbox-triage.ts:200-217). On the Inbox page, if shortlists resolve first, the first pick selects order[0] from the All list; that change can then be hidden under Mine while still open in the detail pane, so the placement shortcuts act on a row not in the queue.\n\nFix: treat read === null as pending; hold the filtered list (or at least the first pick) until people are read."
acceptanceCriteria:
  - "The Inbox and Changes views do not apply or switch the default filter until the people list has loaded"
  - "The Inbox page's first selected change is chosen from the list as filtered after people load"
  - "A test delays the people read and asserts no visible switch and the correct first pick"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
