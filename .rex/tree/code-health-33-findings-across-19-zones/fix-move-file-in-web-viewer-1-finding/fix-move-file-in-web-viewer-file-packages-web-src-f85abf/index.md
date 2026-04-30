---
id: "f85abf7d-3a25-424f-95b6-5d6fccb1340e"
level: "task"
title: "Fix move-file in web-viewer: File \"packages/web/src/viewer/external.ts\" is pinned to zone \"Web Viewer\" but li"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-17T15:30:15.718Z"
completedAt: "2026-04-17T15:32:57.191Z"
resolutionType: "acknowledgment"
resolutionDetail: "Finding is a false positive. Louvain places external.ts near web-server due to shared/schema/ connectivity bridge. All 21 importers are viewer files; pin to web-viewer is correct. Documented the reason inline in external.ts matching the web-server zone stability pattern."
acceptanceCriteria: []
description: "- File \"packages/web/src/viewer/external.ts\" is pinned to zone \"Web Viewer\" but lives in packages/web/src/viewer/ — consider moving to packages/web/src/server/ to align physical location with architectural zone"
recommendationMeta: "[object Object]"
---

# Fix move-file in web-viewer: File "packages/web/src/viewer/external.ts" is pinned to zone "Web Viewer" but li

🟠 [completed]

## Summary

- File "packages/web/src/viewer/external.ts" is pinned to zone "Web Viewer" but lives in packages/web/src/viewer/ — consider moving to packages/web/src/server/ to align physical location with architectural zone

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-04-17T15:30:15.718Z
- **Completed:** 2026-04-17T15:32:57.191Z
- **Duration:** 2m
