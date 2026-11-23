---
id: "6a4b1ece-5479-4c5e-9da0-24c4a7fff031"
type: "change"
title: "Placing or moving a change shows what will happen and why"
slug: "placing-or-moving-a-change-shows-what"
summary: "When someone places or moves a change on the product map, a simple picture shows where it is going, what kind of link it makes, why it was suggested and what will be different afterwards. People can plan with confidence instead of guessing what a click does."
intent: "Placing (Inbox → capability/constraint) and moving/reparenting items currently needs more deliberate direction. Add a simple visual to the placement and move flows: source → target with the relation (touches vs amends) drawn distinctly, the reason the target was suggested (placement-engine strength and rule/model reason), and a before/after of what changes (the capability gains a touching change, or its statement/criteria are amended). The visual updates as the user picks a different target or relation, before anything is written, and the confirm button names the action ('Touch Capability X', 'Amend Capability X')."
acceptanceCriteria:
  - "The placement flow shows a source-to-target visual with touches and amends drawn distinctly"
  - "The visual shows why a target was suggested, using the placement engine's strength and reason"
  - "The visual shows a before/after of what the placement changes on the product layer"
  - "Moving or reparenting an item shows the same kind of source-to-target visual"
  - "The visual updates when the user picks a different target or relation, before anything is written"
  - "The confirm button names the action and target"
  - "Unit tests cover the visual's model for touches, amends and move"
touches:
  - "51527b42-cc67-4a5a-83b3-61179298dfaf"
priority: "medium"
tags:
  - "web"
  - "plan"
  - "placement"
  - "ux"
source: "ndx-capture"
---
