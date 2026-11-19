---
id: "23ef1cc4-adcf-4046-be95-da22807badcb"
type: "task"
title: "Prioritized tag shows on the Inbox triage queue and Plan's Open changes glance"
slug: "prioritized-tag-shows-on-the-inbox"
summary: "Prioritized changes are marked on the Inbox triage page and in Plan's list of open changes, not only in the Inbox tile, so people can see why an item sits at the top."
description: "Seen in the integration screenshots (integration/plan-analyze-stack @ 7bb07a3d3): the /inbox triage queue sorts prioritized changes first but shows no \"Prioritized\" tag, and Plan's Open changes glance shows none either. The Plan Inbox tile and detail panel already show it."
acceptanceCriteria:
  - "A prioritized change in the /inbox triage queue shows the same Prioritized tag as the Plan Inbox tile"
  - "A prioritized change in Plan's Open changes glance shows the Prioritized tag"
  - "A test renders each list with one prioritized and one ordinary change and asserts the tag appears only on the prioritized one"
priority: "medium"
source: "ndx-capture"
---
