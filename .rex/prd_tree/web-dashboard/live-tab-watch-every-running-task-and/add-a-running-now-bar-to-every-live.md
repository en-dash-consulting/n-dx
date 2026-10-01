---
id: "d6092558-f7ae-4b7f-94ae-26a2a30cd8ef"
level: "task"
title: "Add a running-now bar to every Live page so concurrent runs can be switched without going back"
status: "pending"
priority: "high"
tags:
  - "live"
  - "web-viewer"
blockedBy:
  - "ee6d1469-e731-4c4e-868b-ba2684c11c46"
  - "dfb31a58-442b-4ee2-bbff-d2b0b0e58419"
acceptanceCriteria:
  - "With two hench runs and one analyze running, the bar shows four entries (All live plus three) on every Live page and each opens the right page in one click."
  - "[ and ] cycle through the items in bar order and do nothing while typing in a field."
  - "The current entry has aria-current=page; the bar scrolls horizontally rather than wrapping on narrow screens."
  - "An item that finishes while open stays in the bar marked finished until navigation."
description: "When several tasks, or a task and an analysis, run at the same time, the operator must be able to open each one's page and move between them directly. Under the top nav on every Live page, render a bar: \"All live\" (count and stuck count, links to the overview) followed by one entry per live item from the live endpoint (product tile, short title, branch and current step or phase, live or stuck dot). The entry for the page being viewed is marked current. `[` and `]` move to the previous and next item when focus is not in a text field. Entries for runs in another worktree link through that worktree's `/w/<key>/` prefix. When an item finishes while it is open, its entry stays until the operator leaves the page, marked finished."
lastModified: "2026-10-01T00:21:15.227Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
