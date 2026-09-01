---
id: "52ecd173-5437-47fe-b9b7-48b0c930d187"
level: "feature"
title: "Fix suggestion in global (1 finding)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-16T20:25:18.971Z"
completedAt: "2026-04-16T20:25:18.971Z"
acceptanceCriteria: []
description: "- Hub function: jsonResponse in packages/web/src/server/response-utils.ts is called from 22 files — changes here have wide impact, consider if responsibilities can be narrowed\n\n---\n\n- 4 zones exceed architectural risk thresholds (cohesion < 0.4, coupling > 0.6): rex, polling, web-unit, token — mandatory refactoring recommended before further development"
recommendationMeta: "[object Object]"
---

## Children

| Title | Status |
|-------|--------|
| [Fix suggestion in global: 4 zones exceed architectural risk thresholds (cohesion < 0.4, coupling > 0.6): r](./fix-suggestion-in-global-4-zones.md) | completed |
| [Fix suggestion in global: Hub function: jsonResponse in packages/web/src/server/response-utils.ts is calle](./fix-suggestion-in-global-hub-function.md) | completed |
