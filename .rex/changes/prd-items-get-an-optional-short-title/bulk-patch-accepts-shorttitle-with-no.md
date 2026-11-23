---
id: "63bb8c70-941b-4bbf-bd6b-2170f1c3ef73"
type: "task"
title: "Bulk PATCH accepts shortTitle with no uniqueness check, trimming or clearing"
slug: "bulk-patch-accepts-shorttitle-with-no"
summary: "The dashboard's bulk-edit endpoint lets two open items be given the same short name and stores stray spaces and empty names, bypassing the rule that short names are unique. This closes that back door."
description: "Verdict: must-fix (severity medium-high), from the adversarial review of feat/short-titles (571ee73cc).\n\nTrigger (reproduced against dist): PATCH /api/rex/items/bulk {ids:[CH-1 (in_progress), task (pending)], updates:{shortTitle:'  Same  '}} → 200, both open items stored with '  Same  '. Then {ids:[CH-1], updates:{shortTitle:''}} → 200 and stores '' instead of removing the field. Adding shortTitle to the shared PATCHABLE_FIELDS opened the bulk route, which reuses validateItemPatch but has no trim/clear step and no assertShortTitleAvailable call.\n\nEvidence: packages/web/src/server/routes-rex/items.ts:146 (PATCHABLE_FIELDS), :885 and :904 (bulk updateInTree).\n\nReachable by any authenticated API client; the dashboard's bulk UI probably never sends it.\n\nFix (recommended, one line plus a test, ~zero risk): refuse shortTitle on the bulk route with a 400 — two or more open ids sharing one short title always collide, so it has no valid bulk use. Alternative: trim/clear and assert per id inside the transaction (more code, only succeeds for one id)."
acceptanceCriteria:
  - "PATCH /api/rex/items/bulk with shortTitle in updates returns 400 and writes nothing"
  - "The 400 message names shortTitle and says to edit it per item"
  - "A route test covers the refusal"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
source: "ndx-adversarial-review"
---
