---
id: "d8e50c7c-d2a3-40df-aaee-9e67380fc676"
level: "task"
title: "Address relationship issues (3 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-08T18:17:38.307Z"
completedAt: "2026-03-08T18:29:08.180Z"
acceptanceCriteria: []
description: "- docs/architecture/ files are referenced from CLAUDE.md but have no automated freshness check. If architectural decisions change (e.g. the four-tier hierarchy evolves or gateway rules shift), these documents will silently become stale without any tooling signal.\n- The co-location of packages/hench/src/store/suggestions.ts with web package files in this zone creates a false import-graph edge between the hench and web tiers. Any zone-coupling metric that includes this zone will over-report cross-tier coupling until suggestions.ts is reassigned to hench-agent.\n- The single usage→web-dashboard import is the only dependency that flows against the expected data-consumer direction (viewer should pull from analytics, not the reverse); verify this import is not a hidden circular initialization dependency"
recommendationMeta: "[object Object]"
---
