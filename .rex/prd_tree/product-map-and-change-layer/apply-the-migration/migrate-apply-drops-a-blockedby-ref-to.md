---
id: "b9af2731-eee4-4228-8421-dc350b913e37"
level: "task"
title: "migrate --apply drops a blockedBy ref to an unbuilt capability as \"met\" when its pending work is held in the Inbox"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-23"
  - "lane-migration"
  - "rex"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A v1 task blockedBy a feature that becomes a proposed capability whose only pending work is held in the Inbox is, after apply, blockedBy those held changes (or, if option (b) is chosen, the dry run labels the drop as unplaced rather than met) (fixture test)"
  - "A ref dropped because the product node is met (v1 completed or built on by an applied change) is still dropped and labelled met (test)"
description: "Found by the adversarial review of 5fc180fd (rewriteRequirementBlockers, packages/rex/src/migrations/v1-to-v2/apply.ts). Verdict: should-fix.\n\nFailure: \"open changes\" of a capability are only changes that touch or amend it. A held change (Inbox, needsPlacement) has no target, so a capability whose pending v1 work was all held counts as having no open change, and every blockedBy ref to it is dropped and labelled \"dropped (no open change: met)\". The capability is proposed, not met. On this repository with a rules-only plan, almost every product ref (≈50 of 58 rewrites) is dropped this way, including refs to \"Dashboard on the v2 model\" and \"Agent brief from the product layer\". The dependent change becomes selectable as soon as it is placed, before the work it waited on.\n\nReachability: ndx migrate --apply on any v1 tree whose pending features under a capability are held (always under a rules-only plan; less often after a model pass).\n\nThis follows decision S2-Q1 literally, so the fix is a decision for Ryan. Options:\n(a) Count a held change as open on the capability its v1 parent became (the v1 feature id), for blocker purposes only. Cheap (a map from held change to its v1 parent's node when that is a product node); keeps the dependency. Risk: none to placement, since only blockedBy reads it. Recommended.\n(b) Keep dropping, but label the drop truthfully (\"no placed open change\", not \"met\") and list it as needing review in the dry run. Cheapest; loses the ordering.\n(c) Leave as is."
lastModified: "2026-10-16T02:41:17.415Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
