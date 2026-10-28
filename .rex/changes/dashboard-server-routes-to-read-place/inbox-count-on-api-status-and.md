---
id: "af3b3ee8-bbe5-43df-b37f-3f272de73084"
type: "task"
title: "Inbox count on /api/status, and awaitsPlacement on change rows"
slug: "inbox-count-on-api-status-and"
description: "Add `rex.inbox: { open, appliedUnplaced }` to the `/api/status` body on a v2 tree: `open` counts open changes rex's `awaitsPlacement` holds (the ones ndx work refuses); `appliedUnplaced` counts applied changes still flagged `needsPlacement` (156 on this repo after the migration; IB2). Omit it on v1. Update the viewer's mirror and its shape check in `viewer/hooks/use-project-status.ts` so a missing field is tolerated.\n\nAdd `awaitsPlacement?: boolean` to `ChangeRowWire` in `routes-rex/product.ts` (and `ChangeRow` in `viewer/views/product-model.ts`), so the viewer tells open Inbox changes from applied history without re-deriving rex's rule."
acceptanceCriteria:
  - "/api/status on v2 includes rex.inbox with open and appliedUnplaced; v1 omits it"
  - "The counts match rex's awaitsPlacement and needsPlacement on the fixture"
  - "Change rows carry awaitsPlacement for held open changes only"
  - "use-project-status accepts the body with and without rex.inbox"
priority: "high"
tags:
  - "inbox-placement"
  - "web"
source: "ndx-capture"
---
