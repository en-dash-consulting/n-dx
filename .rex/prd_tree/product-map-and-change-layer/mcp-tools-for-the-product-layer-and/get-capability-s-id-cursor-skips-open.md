---
id: "e51d83d8-febb-4b82-9485-8ec394717a4f"
level: "task"
title: "get_capability's id cursor skips open changes when the cursor change is applied mid-paging"
status: "in_progress"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "pr-17"
  - "rex"
  - "lane-rex-surface"
  - "pr-review"
source: "ndx-adversarial-review"
startedAt: "2026-10-09T04:25:24.798Z"
acceptanceCriteria:
  - "With status all, limit 2 and open changes [a, b, c, d]: page 1 returns [a, b]; after b is applied, continuing with page 1's cursor returns c and d, never an empty page with no next cursor (regression test from the PR #612 review)"
  - "The cursor is opaque and encodes the last row's position (group, appliedAt, id), so continuation does not depend on where that change sits in the re-sorted list (test)"
  - "A change that moves group between pages may appear again later in the listing, but no change present for the whole listing is skipped (test)"
  - "A malformed or foreign cursor is refused with a message to restart without a cursor (test)"
  - "get_capability's input shape is unchanged (cursor stays a string); get_prd_status paging, if it uses the same helper, gets the same semantics"
run: {"contextNotes":"Rebuild before finishing: after your last edit under packages/<pkg>/src, run `pnpm --filter @n-dx/<pkg> build`, and run it again if the adversarial review repairs any file under packages/<pkg>/src. Hench runs its affected test gate right after the review without rebuilding, and the gate refuses a stale dist/ (runs d3e891fe and 699cd138 failed this way; tracked as a hench bug under d0c26ff0)."}
description: "Verdict: should-fix (low). Found by adversarial review of 915602c4.\n\nThe cursor in pageChanges (packages/rex/src/core/product-report.ts) is the id of the last change returned, and the next page starts after that id's position in a list ordered open first (tree order), then applied by appliedAt descending. If that change is applied between calls, it moves from the open group to the head of the applied group. Example: call get_capability with status \"all\" and limit 2, where open = [A, X, B, C], and the page returns [A, X] with cursor X. X is then applied, so the list becomes [A, B, C, X, ...applied]. The next page starts after X, so B and C are never returned. Only status all/recent are affected; status open rejects the stale cursor with an error.\n\nHow it is reached: the rex MCP get_capability call while ndx work, apply_change or update_task_status applies a change at the same time.\n\nOptions:\n(a) Keyset cursor: an opaque string encoding (group, appliedAt, id), resuming from the first item that sorts after it. It is stable under moves and costs about 20 lines plus a test. Recommended.\n(b) Document that a cursor is valid only while the history is unchanged. This costs nothing but leaves a silent skip.\n\nPR #612 review (ryrykeith, 2026-10-09, P2, packages/rex/src/core/product-report.ts:203) reproduced it: status all, limit 2, open [a, b, c, d]; page 1 [a, b]; apply b → order [a, c, d, b]; cursor b returns an empty page and no next cursor, silently omitting c and d. Moved back under PR 17 to fix before merge.\n\nDecided 2026-10-08 (Ryan): a stable keyset cursor, not detect-and-restart. Encode (group, appliedAt, id) of the last row in an opaque cursor and continue strictly after that position in the current ordering. Lane: core/product-report.ts (pageChanges), get-capability.ts description if needed, tests."
lastModified: "2026-10-09T04:25:25.034Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
