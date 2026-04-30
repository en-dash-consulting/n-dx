---
id: "251fbe0a-8b4f-4cb0-a22a-326bf24e64f4"
level: "task"
title: "Address relationship issues (3 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-05T05:13:25.945Z"
completedAt: "2026-03-05T05:18:59.365Z"
acceptanceCriteria: []
description: "- web-viewer bypasses web-integration for 4 of its 6 message-zone imports, importing message directly rather than through the integration layer. This partial bypass means web-integration is not enforcing a stable interface over message for web-viewer, leaving web-viewer exposed to message internals directly.\n- web-viewer simultaneously imports from web, web-integration, viewer-call-rate-limiter, and viewer-message-flow-control — it is the hub of all non-zero coupling in the web layer; if web-viewer grows further, these four inbound dependency paths will become increasingly difficult to untangle\n- web-integration acts as an implicit middleware hub: it imports from both message and web while being imported by web-viewer. This three-way relay role is not documented and risks becoming a catch-all as the codebase grows. Define a clear responsibility boundary for this zone."
recommendationMeta: "[object Object]"
---

# Address relationship issues (3 findings)

🟠 [completed]

## Summary

- web-viewer bypasses web-integration for 4 of its 6 message-zone imports, importing message directly rather than through the integration layer. This partial bypass means web-integration is not enforcing a stable interface over message for web-viewer, leaving web-viewer exposed to message internals directly.
- web-viewer simultaneously imports from web, web-integration, viewer-call-rate-limiter, and viewer-message-flow-control — it is the hub of all non-zero coupling in the web layer; if web-viewer grows further, these four inbound dependency paths will become increasingly difficult to untangle
- web-integration acts as an implicit middleware hub: it imports from both message and web while being imported by web-viewer. This three-way relay role is not documented and risks becoming a catch-all as the codebase grows. Define a clear responsibility boundary for this zone.

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-03-05T05:13:25.945Z
- **Completed:** 2026-03-05T05:18:59.365Z
- **Duration:** 5m
