---
id: "e991d894-32d5-400f-bda9-b947640c60f4"
level: "task"
title: "Address pattern issues (4 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-11T05:58:45.290Z"
completedAt: "2026-03-11T07:00:32.892Z"
resolutionType: "code-change"
resolutionDetail: "Pinned 11 viewer-internal files (components, views, graph, usage) from web-peripheral to web-viewer zone, eliminating all 4 bidirectional import warnings. Deleted dead node-culler.ts to improve web-shared cohesion above 0.5 threshold."
acceptanceCriteria: []
description: "- Foundation layer web-shared has cohesion of only 0.46, the lowest of any production web zone — a foundation should be highly cohesive; the low score suggests it accumulates unrelated utilities that would be better placed in their consuming zones\n- web-viewer actively imports 21 symbols from web-peripheral while web-peripheral imports 15 from web-viewer. A hub importing from its own spoke periphery creates a circular cluster at the hub layer; the hub should be a stable dependency target, not a consumer of peripheral files.\n- web-viewer has 61 outbound vs 25 inbound cross-zone imports — net consumer profile contradicts the documented hub role. True hubs are imported more than they import. Consider whether some outbound edges indicate responsibilities that should be extracted into a lower-layer zone.\n- web-viewer participates in 5 distinct bidirectional import cycles (with web, web-server, web-unit, crash, and implicitly web-shared via the hub role) — this density of bidirectionality makes safe refactoring extremely difficult and indicates the hub has grown beyond a manageable boundary"
recommendationMeta: "[object Object]"
---

# Address pattern issues (4 findings)

🟠 [completed]

## Summary

- Foundation layer web-shared has cohesion of only 0.46, the lowest of any production web zone — a foundation should be highly cohesive; the low score suggests it accumulates unrelated utilities that would be better placed in their consuming zones
- web-viewer actively imports 21 symbols from web-peripheral while web-peripheral imports 15 from web-viewer. A hub importing from its own spoke periphery creates a circular cluster at the hub layer; the hub should be a stable dependency target, not a consumer of peripheral files.
- web-viewer has 61 outbound vs 25 inbound cross-zone imports — net consumer profile contradicts the documented hub role. True hubs are imported more than they import. Consider whether some outbound edges indicate responsibilities that should be extracted into a lower-layer zone.
- web-viewer participates in 5 distinct bidirectional import cycles (with web, web-server, web-unit, crash, and implicitly web-shared via the hub role) — this density of bidirectionality makes safe refactoring extremely difficult and indicates the hub has grown beyond a manageable boundary

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-03-11T05:58:45.290Z
- **Completed:** 2026-03-11T07:00:32.892Z
- **Duration:** 1h 1m
