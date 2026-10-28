---
id: "0234dd78-a3b7-4385-beeb-80a5c139307a"
type: "task"
title: "Apply a change awaiting apply from the dashboard"
slug: "apply-a-change-awaiting-apply-from-the"
description: "The dashboard has no apply action (routes-rex/product.ts notes it). Add a route that previews and then applies an open change whose work is completed, through rex's apply (the same core as MCP apply_change and rex change apply), inside withPrdModelTransaction, broadcasting rex:prd-changed. In the change's detail panel, an Apply… button for a change awaiting apply shows the preview (amendments and their effect on the product map) and applies on confirm; refusals show rex's own message. The strip's Awaiting apply count links to these changes."
acceptanceCriteria:
  - "A change awaiting apply shows Apply… in its detail panel, and other changes do not"
  - "Apply… shows a preview and writes only on confirm, through rex's apply core via the web rex gateway"
  - "A refused apply shows rex's message and writes nothing"
  - "Route tests cover preview, success, refusal and a v1 project (409)"
priority: "medium"
source: "ndx-capture"
---
