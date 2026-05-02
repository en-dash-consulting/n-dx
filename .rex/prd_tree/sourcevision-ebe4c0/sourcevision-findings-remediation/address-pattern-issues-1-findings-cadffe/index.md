---
id: "cadffe40-c450-4a45-90c4-40a1c335eaf1"
level: "task"
title: "Address pattern issues (1 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-10T00:20:52.552Z"
completedAt: "2026-03-10T00:31:53.658Z"
resolutionType: "config-override"
resolutionDetail: "Re-pinned 4 MCP-route files (domain-gateway.ts, routes-mcp.ts, and their tests) from web-dashboard to new mcp-route-layer zone in .n-dx.json. Added zone type classification and health annotation. Removed stale sourcevision-mcp-gateway annotation."
acceptanceCriteria: []
description: "- Zone ID 'web-dashboard' is assigned to two distinct zone entries (372-file main zone and 4-file MCP route sub-zone) — deduplicate zone IDs so health metrics are not silently merged across structurally different groups."
recommendationMeta: "[object Object]"
---

# Address pattern issues (1 findings)

🟠 [completed]

## Summary

- Zone ID 'web-dashboard' is assigned to two distinct zone entries (372-file main zone and 4-file MCP route sub-zone) — deduplicate zone IDs so health metrics are not silently merged across structurally different groups.

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-03-10T00:20:52.552Z
- **Completed:** 2026-03-10T00:31:53.658Z
- **Duration:** 11m
