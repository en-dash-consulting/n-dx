---
id: "6b4127ed-4c0b-4bf4-ae0a-43e6f7e65c8c"
level: "task"
title: "Fix structural in local-docker-harness: Zone cohesion is 0 across 5 files — below the 5-file metric-reliability threshol"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-18T15:26:24.624Z"
completedAt: "2026-04-18T15:29:56.808Z"
resolutionType: "config-override"
resolutionDetail: "Added zone type overrides for .local-testing and local-docker-harness as infrastructure in .n-dx.json; added hints.md entry explaining the zone and why cohesion 0 is expected for gitignored infra scripts."
acceptanceCriteria: []
description: "- Zone cohesion is 0 across 5 files — below the 5-file metric-reliability threshold, so the low score reflects the absence of import relationships among infra scripts rather than structural decay."
recommendationMeta: "[object Object]"
---
