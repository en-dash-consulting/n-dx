---
id: "b1fac5d6-941f-4447-96e2-3089210cef78"
level: "task"
title: "rex reshape aborts with no draft when one product proposal places an added node under a node another proposal removes"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-18"
  - "rex"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "rex reshape --accept with proposals 'obsolete A2' and 'reparent A1.1 under A2' drafts the first and reports the second as not drafted, without an error (test)"
  - "A product proposal apply would refuse never stops the change-layer reshape pass (test)"
description: "Verdict: should-fix (found reviewing 91461587).\n\nScenario: on a v2 tree, accepted product-layer proposals \"obsolete area A2\" and \"reparent capability A1.1 under A2\". draftProductReshape (packages/rex/src/core/product-reshape.ts, the `claimed` check in draftProductReshape) only tracks the targets of removed/modified amendments, not an added amendment's `under`, so both are drafted. addProductReshapeChange -> addChangeNode dry-runs apply, which refuses (\"under A2 is not a live area or capability\") and throws AddChangeNodeError. reshapeProductLayer (packages/rex/src/cli/commands/reshape-product.ts) does not catch it, so `rex reshape --accept` fails: nothing is drafted and the change-layer pass never runs. The same happens for any proposal set whose combined amendments apply refuses.\n\nReachable: `rex reshape --accept` (or interactive accept) on a v2 tree, from LLM proposals.\n\nOptions: (1) also claim an added amendment's `under`, and skip a proposal whose under/target an earlier one removes (cheap; covers the known clash). (2) Draft proposals one at a time, dry-running apply (applyAmendmentsProblems) after each and skipping the one that makes it refuse, reporting apply's problem (robust; a few more rule runs). Recommend (2).\n\nChosen (overnight 2026-10-09, reversible): option 2. Draft accepted product proposals one at a time, dry-run apply (applyAmendmentsProblems) after each, skip a proposal that makes apply refuse and report apply's problem; the change-layer pass still runs. No change to apply's rules or the schema."
lastModified: "2026-10-09T07:38:30.782Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
