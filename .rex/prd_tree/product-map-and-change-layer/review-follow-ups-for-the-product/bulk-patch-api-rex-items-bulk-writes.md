---
id: "8dfcc145-6003-4d58-9687-1a4c735868c7"
level: "task"
title: "Bulk PATCH /api/rex/items/bulk writes fields the single PATCH refuses"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "review-2026-10-12"
  - "web"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "PATCH /api/rex/items/bulk with updates {run: {...}} answers 400 naming the field and writes nothing (route test)"
  - "PATCH /api/rex/items/bulk with updates {title: \"\"} answers 400 and writes nothing (route test)"
  - "Bulk and single PATCH share one field validator"
description: "Out-of-scope finding from the adversarial review of task db1a04e4 (pre-existing). packages/web/src/server/routes-rex/items.ts handleBulkUpdate validates only `updates.status`; every other key goes straight into updateInTree. The single PATCH (`validateItemPatch`, PATCHABLE_FIELDS) refuses `run`, `id`, `level`, timestamps, blockedBy and children, and type-checks title/tags/etc. Scenario: PATCH /api/rex/items/bulk {ids:[T], updates:{run:{tier:\"heavy\"}}} writes T's run block, bypassing the version-checked PUT /api/hench/prep/:taskId that the single route says is the only writer of `run`; {updates:{title:\"\"}} writes an empty title. Reachable from any local client of the dashboard API (the viewer itself sends status only). Fix: run validateItemPatch on `input.updates` in the bulk handler (cheap, one call; risk: a client sending other fields gets 400). Recommended. Verdict: out-of-scope (pre-existing), worth fixing."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-13T16:41:32.937Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
