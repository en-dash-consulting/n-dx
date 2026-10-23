---
id: "e991d894-32d5-400f-bda9-b947640c60f4"
type: "task"
title: "Address pattern issues (4 findings)"
slug: "address-pattern-issues-4-findings-e991d8"
description: "- Foundation layer web-shared has cohesion of only 0.46, the lowest of any production web zone — a foundation should be highly cohesive; the low score suggests it accumulates unrelated utilities that would be better placed in their consuming zones\n- web-viewer actively imports 21 symbols from web-peripheral while web-peripheral imports 15 from web-viewer. A hub importing from its own spoke periphery creates a circular cluster at the hub layer; the hub should be a stable dependency target, not a consumer of peripheral files.\n- web-viewer has 61 outbound vs 25 inbound cross-zone imports — net consumer profile contradicts the documented hub role. True hubs are imported more than they import. Consider whether some outbound edges indicate responsibilities that should be extracted into a lower-layer zone.\n- web-viewer participates in 5 distinct bidirectional import cycles (with web, web-server, web-unit, crash, and implicitly web-shared via the hub role) — this density of bidirectionality makes safe refactoring extremely difficult and indicates the hub has grown beyond a manageable boundary"
priority: "high"
source: "sourcevision"
---
