---
id: "6a22c989-085b-45a3-9a8f-ac785ad2add2"
level: "task"
title: "Fix structural in viewer-data-hooks: Bidirectional imports between this hook zone and the web platform zone (3 edges "
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-19T02:56:41.315Z"
completedAt: "2026-04-19T02:59:59.438Z"
resolutionType: "config-override"
resolutionDetail: "Pinned use-gateway.ts, use-project-status.ts, and test file to web-viewer; moved use-polling.ts pin from web-dashboard to web-viewer. All 4 viewer-data-hooks files now belong to web-viewer, collapsing the artificial Louvain zone and eliminating the 6 bidirectional cross-zone edges."
acceptanceCriteria: []
description: "- Bidirectional imports between this hook zone and the web platform zone (3 edges each direction) suggest the hooks may be reaching back into platform code rather than receiving dependencies via props or context."
recommendationMeta: "[object Object]"
---
