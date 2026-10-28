---
id: "f08da1e0-5214-4cf0-a4b6-a717c58b6f7d"
type: "task"
title: "Capture Preview: pick a placement, then Add & place"
slug: "capture-preview-pick-a-placement-then"
description: "In `ChangePreviewCard` (`components/prd-tree/smart-add-input.ts`), turn \"Suggested placement\" into radio rows: candidate title, strength chip, area and matched words (from the preview's placement data; extend the server preview payload in `routes-rex-analysis.ts` with strength, area and reasons if it lacks them, using rex's strength helper). Add a final \"Leave it in the Inbox\" row, a \"Search all\" field (the product map from `GET /api/rex/product`), and a Touches / Amends… choice.\n\nDefault (IB8): pre-select the top candidate only when its strength is strong and the shortlist is not tied; otherwise pre-select \"Leave it in the Inbox\".\n\nActions: with a candidate and Touches, the primary button reads \"Add 1 change & place it\" and posts `touches` to `POST /api/rex/items` (PR 2). With Leave it in the Inbox, it reads \"Add to Inbox\" as today. With Amends…, add the change to the Inbox, then open its detail panel at Where it goes with Amends selected. Replace the `V2_NEXT_STEP` copy to match what was chosen. Multi-change previews get the choice per card."
acceptanceCriteria:
  - "Each preview card offers candidates with strength and area, Leave it in the Inbox, search and Touches/Amends…"
  - "A strong untied top pick is pre-selected; otherwise Leave it in the Inbox is"
  - "Add & place creates a change that is not in the Inbox and touches the chosen node"
  - "Amends… adds the change and opens its detail panel on Amends"
  - "smart-add-input tests and smart-add-v2-changes integration test cover each path"
priority: "medium"
tags:
  - "inbox-placement"
  - "web"
source: "ndx-capture"
---
