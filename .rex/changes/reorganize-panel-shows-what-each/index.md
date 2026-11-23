---
id: "3afe397d-9873-41bc-aea7-96192230fae2"
type: "change"
title: "Reorganize panel shows what each proposed move will do"
slug: "reorganize-panel-shows-what-each"
summary: "The Reorganize panel proposes moving items around the plan but only lists them as text. This adds the same simple before-and-after picture the Ask panel now shows, so people can see what each move does before applying it."
intent: "Follow-up split from change 6a4b1ece by the adversarial review of feat/placement-visuals (verdict should-fix, severity medium; the user chose to track it separately).\n\nThe rex dashboard's Quick Actions → Reorganize panel (packages/web/src/viewer/components/prd-tree/reorganize-panel.ts:189-245) lists structural move and LLM reparent proposals as icon, description and 'Affects: …' with 'Apply Selected (N)'. Draw the placement-preview movePreview (components/placement-preview.ts, from 6a4b1ece) in each move/reparent card: item, old parent, new parent, rationale, before/after, and name the action. Structural move proposals carry only description and items, so the server must add from/to parent ids and titles to them."
acceptanceCriteria:
  - "Each move and reparent proposal in the Reorganize panel shows the item, its current parent and its new parent as a source-to-target visual"
  - "Structural move proposals from the server carry the from and to parent ids and titles"
  - "Each proposal's visual names the action (Move to <parent>)"
  - "Tests cover the server proposal fields and the panel rendering"
touches:
  - "51527b42-cc67-4a5a-83b3-61179298dfaf"
priority: "medium"
discoveredFrom: {"item":"6a4b1ece-5479-4c5e-9da0-24c4a7fff031"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "web"
source: "ndx-adversarial-review"
blockedBy:
  - "6a4b1ece-5479-4c5e-9da0-24c4a7fff031"
---
