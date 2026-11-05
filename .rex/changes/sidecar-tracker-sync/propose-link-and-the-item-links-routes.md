---
id: "4986e450-9155-4152-a755-d6685c9679e0"
type: "task"
title: "propose_link and the item links routes refuse a change's display id (CH-142) as \"no item\""
slug: "propose-link-and-the-item-links-routes"
description: "Verdict should-fix (adversarial review of 4700837f). packages/web/src/server/tracker/link-card.ts readLinkCall calls store.getItem(itemId) and item-links.ts changeItemLink uses findItem(doc.items, itemId); neither resolves a display id. Scenario: the Sidecar agent, which reads display ids in its packets, calls propose_link { itemId: \"CH-142\", ref: \"WM-1\" } -> \"No card was raised: no item CH-142\"; POST /api/rex/items/CH-142/links -> 404. The agent can retry with the UUID, so nothing is written wrong. Options: (A) resolve the ref through rex's resolveItemRef. That needs a rex-gateway export, so check the gateway cap first. (B) Resolve the ref in web by matching a node's displayId in the loaded doc. This is cheap, and recommended if it avoids a gateway export. (C) Say in the tool description that itemId takes the UUID. This is cheapest, but the agent still guesses wrong."
acceptanceCriteria:
  - "propose_link with a change's display id raises a link card naming the change's UUID (broker test)"
  - "POST /api/rex/items/<display id>/links writes the ref to the named change (route test)"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
