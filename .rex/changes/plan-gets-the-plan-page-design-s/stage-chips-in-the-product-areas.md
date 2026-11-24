---
id: "e9fea9c9-5616-42fa-ac4e-f94a1174cfc2"
type: "task"
title: "Stage chips in the Product areas header focus Plan on one stage"
slug: "stage-chips-in-the-product-areas"
summary: "Small stage buttons with counts above the product areas let you focus Plan on one stage of work (Inbox, Proposed, Ready, In progress, Awaiting apply) and clear it with Show all, replacing the clickable stage row the design showed."
description: "Design: 'How work moves' stages were buttons ('Click a stage to focus on it', 'Show all'). That row is removed by change 9b482f7e, so the filter becomes compact chips in the Product areas tile header, each with its count from the change summary. Pressing one filters the area boxes (and the Inbox panel for the Inbox stage) to that stage; pressing it again or Show all clears it. Chips are toggle buttons (aria-pressed)."
acceptanceCriteria:
  - "The Product areas header shows a chip per stage with its count"
  - "Pressing a chip shows only that stage's changes in the area boxes; pressing it again or Show all clears the filter"
  - "Chips are buttons with aria-pressed and work from the keyboard (unit test)"
  - "The filter combines with For me / Everyone"
priority: "medium"
source: "ndx-capture"
blockedBy:
  - "546f2519-2451-44b7-a579-2580cc1d7f14"
---
