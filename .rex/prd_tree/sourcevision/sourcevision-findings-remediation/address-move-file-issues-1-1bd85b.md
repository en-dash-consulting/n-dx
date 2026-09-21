---
id: "1bd85bb8-db2a-46a2-ba7c-1f0048aeb359"
level: "task"
title: "Address move-file issues (1 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-11T15:56:58.317Z"
completedAt: "2026-03-11T16:00:28.327Z"
resolutionType: "code-change"
resolutionDetail: "Moved progressive-loader.ts from prd-tree/ to components/ to align physical location with web-viewer zone pin. Updated internal imports, test imports, @see references, and zone pin path in .n-dx.json."
acceptanceCriteria: []
description: "- File \"packages/web/src/viewer/components/prd-tree/progressive-loader.ts\" is pinned to zone \"Web Viewer Hub\" but lives in packages/web/src/viewer/components/prd-tree/ — consider moving to packages/web/src/viewer/components/ to align physical location with architectural zone"
recommendationMeta: "[object Object]"
---
