---
id: "e51d83d8-febb-4b82-9485-8ec394717a4f"
level: "task"
title: "get_capability's id cursor skips open changes when the cursor change is applied mid-paging"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "pr-17"
  - "rex"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A test that applies the cursor's change between two get_capability pages (status all) still returns every change that was open before it"
  - "The cursor is opaque, and a malformed one is refused with a clear error"
description: "Verdict: should-fix (low). Found by adversarial review of 915602c4.\n\nThe cursor in pageChanges (packages/rex/src/core/product-report.ts) is the id of the last change returned, and the next page starts after that id's position in a list ordered open first (tree order), then applied by appliedAt descending. If that change is applied between calls, it moves from the open group to the head of the applied group. Example: call get_capability with status \"all\" and limit 2, where open = [A, X, B, C], and the page returns [A, X] with cursor X. X is then applied, so the list becomes [A, B, C, X, ...applied]. The next page starts after X, so B and C are never returned. Only status all/recent are affected; status open rejects the stale cursor with an error.\n\nHow it is reached: the rex MCP get_capability call while ndx work, apply_change or update_task_status applies a change at the same time.\n\nOptions:\n(a) Keyset cursor: an opaque string encoding (group, appliedAt, id), resuming from the first item that sorts after it. It is stable under moves and costs about 20 lines plus a test. Recommended.\n(b) Document that a cursor is valid only while the history is unchanged. This costs nothing but leaves a silent skip."
lastModified: "2026-10-09T02:22:00.146Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
