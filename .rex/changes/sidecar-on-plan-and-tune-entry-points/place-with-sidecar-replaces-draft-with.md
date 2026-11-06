---
id: "df78a8d3-c5a4-434e-86b9-840a59b77c2f"
type: "task"
title: "Place with Sidecar replaces Draft with the model when the Sidecar is on"
slug: "place-with-sidecar-replaces-draft-with"
description: "SP3. In change-placement.ts (compact and wide), when web.sidecar is on show \"Place with Sidecar\" (the existing PlaceWithSidecarButton) and not \"Draft with the model\". With web.sidecar off and rex.placementDraft on, the one-shot draft stays as S7's \"model\" card. With both off, neither shows."
acceptanceCriteria:
  - "web.sidecar on: Place with Sidecar shows and Draft with the model does not"
  - "web.sidecar off and rex.placementDraft on: Draft with the model shows"
  - "Both off: neither shows"
  - "Tests cover the three toggle states"
priority: "medium"
source: "ndx-capture"
---
