---
id: "8967d9cb-bb4e-4bf2-a80a-af0d0444318c"
level: "task"
title: "A revert withdraws only the first of several open product-edit drafts for the same node"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "pr-10"
  - "rex"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "With two open product-edit drafts amending A1.1, editing back to the met spec leaves neither open nor amending it (test)"
  - "With two open drafts, a substantive edit leaves no open draft proposing an older statement (test)"
description: "Verdict: should-fix. Found reviewing 73a63ca4 (commit f1f39f482).\n\nScenario: two branches each edit met A1.1, and each drafts its own product-edit change with a different UUID. Merging both branches leaves two open drafts amending A1.1. A later edit back to the met spec calls withdrawDraft (packages/rex/src/core/product-edit.ts), which uses openDraft and handles only the first draft. It returns \"reverted\", but the second draft stays open proposing the abandoned spec, and applying it overwrites the revert. The refresh path (`if (open)` in handleProductEdit) has the same single-draft assumption: it refreshes one draft and leaves the other proposing an older spec.\n\nhandleProductEdit cannot create two open drafts by itself, so this is reachable only after a merge, and only once the handler is wired.\n\nOptions:\n(a) Have openDraft return every matching open draft, then withdraw all of them on a revert and refresh or report all of them on a refresh. Cheap. Recommended.\n(b) Have a v2 rule report two open product-edit drafts that amend one node. Detection only.\n\nDecision (2026-10-07, Ryan): option (a). openDraft returns every matching open product-edit draft; a revert withdraws all of them and a refresh refreshes or reports all of them. Done in the same run as f1581c8a."
lastModified: "2026-10-08T00:49:47.406Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
