---
id: "97f65c3a-2c23-439c-8de3-482f8dcdb1c5"
type: "task"
title: "A capability page no longer links to the Inbox draft its own spec edit created"
slug: "a-capability-page-no-longer-links-to"
description: "Verdict: should-fix (medium). Found reviewing f8f7cb2f (commit 0d6effc6b).\n\nScenario: on a v2 project a steward edits a capability's spec on the Product page without ticking editorial. rex drafts an Inbox change (needsPlacement, amends that capability), and the form says \"a change is drafted in the Inbox\". Since 0d6effc6b, isMovingChange (packages/web/src/server/routes-rex/product.ts:322) leaves held changes out of overlaysByNode as well. GET /product/capability/:id therefore answers openChanges: [], so the capability page's \"Open changes\" section (viewer/views/capability.ts:393) and the Product table's overlay cell no longer show the draft. On main, overlaysByNode used isOpenChange and listed it. The steward has no link from the capability to the draft they just made; they have to find it in the Inbox.\n\nReachability: POST /product/edit, then the capability page. Nothing covers this: no viewer or route test asserts that the capability lists its draft.\n\nOptions:\n1. (Recommended) Add a separate `inboxChanges` (held changes that amend or touch the node) to the capability detail and row wire, and render it as \"Waiting in the Inbox\" on the capability page. The overlays and the Product total stay as they are. Cost: one wire field plus a small viewer section, and a soft-freeze changeset line.\n2. Keep held changes in overlaysByNode with an `awaitsPlacement` flag, and make product-model's total skip flagged ones. Cheaper, but it puts the count rule back in the viewer, which this stack moved to the server."
acceptanceCriteria:
  - "GET /api/rex/product/capability/:id for a capability with a needsPlacement change amending it returns that change in a held/Inbox field, and still leaves it out of openChanges (route test)"
  - "The capability page shows the held draft under a Waiting in the Inbox heading with a link to it, and not under Open changes (viewer test)"
  - "The Product total still equals Proposed plus In progress when a held draft exists"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
