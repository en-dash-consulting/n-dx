---
id: "db1a04e4-553b-46c7-9635-9a03f1646d4a"
level: "task"
title: "A v2 PATCH that both completes and edits a field must not half-apply"
status: "pending"
priority: "high"
tags:
  - "pr-36"
  - "review-2026-10-12"
  - "lane-web"
source: "review-2026-10-12"
acceptanceCriteria:
  - "PATCH /api/rex/items/<inbox change> {status: completed, title: X} on a v2 copy is refused and the change's title is unchanged on disk (route test that fails on 4a7b64a8c8)"
  - "The bulk PATCH with the same item reports ok:false for it and writes none of its fields (route test)"
  - "A successful completing PATCH with fields writes both and refreshes the cache and broadcast; v1 PATCH is unchanged"
description: "Review 2026-10-12, PR #693 should-fix 1 (CONFIRMED live).\n\nDefect: packages/web/src/server/routes-rex/items.ts:191-198 (single PATCH) and :504-537 (bulk). On v2 the field updates are committed in one store.withTransaction, and completeV2Work then runs in a separate rex transaction. When the completion is refused, the client gets 400 (or ok:false in bulk) but the field edit is already saved, and the response is sent without a cache refresh or broadcast.\n\nFailure scenario (reproduced): PATCH /api/rex/items/<inbox change> {\"status\":\"completed\",\"title\":\"Renamed dup\"} returned 400 \"Cannot complete change …: it still needs placement…\", yet changes/add-apple-pay-a90df1/index.md now reads title: \"Renamed dup\". The detail panel's error tells the user nothing was saved.\n\nFix: use the same order rule as rex update (A2, PR 34): run the completion first and write the other fields only if it succeeded, so a refused completion writes nothing; or refuse a completing PATCH that carries other fields on v2 with 400 \"complete first, then edit\". Apply it to the single and bulk paths, and refresh the cache and broadcast whenever anything was written. v1 PATCH behaviour is unchanged."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T18:23:57.697Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
