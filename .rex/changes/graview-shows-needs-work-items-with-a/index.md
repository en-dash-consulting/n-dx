---
id: "b668a77b-b497-4193-af52-f14718cbc43f"
type: "change"
title: "Graview shows needs-work items with a '!' marker"
slug: "graview-shows-needs-work-items-with-a"
summary: "The Graview product map shows the same items the Analysis page recommends working on, marked with a '!' so they stand out from items that are only highlighted. People see where the work is wherever they look at the product."
intent: "The Analysis page highlights items in two ways: items that need work (recommended fixes from findings) and other highlights (e.g. zones flagged for attention). Carry both into the Graview projection (ndx graview emit writes the document and {nodes, edges} snapshot) and the graview-face app, so they render in the Graview app. Items that need work show a '!' badge; other highlighted items use a distinct, non-'!' treatment, so the two are easy to tell apart. Uses the same recommended-item set as the Analysis page's recommended-fixes tile."
acceptanceCriteria:
  - "ndx graview emit includes, for each node, whether it needs work and whether it is otherwise highlighted"
  - "The graview-face app renders a '!' badge on items that need work"
  - "Otherwise-highlighted items use a distinct treatment that is not the '!' badge"
  - "The needs-work set matches the items the Analysis page recommends"
  - "ndx graview check passes on the emitted document"
  - "Tests cover the emitted flags and the face's rendering of both treatments"
touches:
  - "1fadb108-b5a8-405c-8699-bdba069663fc"
priority: "medium"
tags:
  - "graview"
  - "graview-face"
  - "analysis"
source: "ndx-capture"
---
