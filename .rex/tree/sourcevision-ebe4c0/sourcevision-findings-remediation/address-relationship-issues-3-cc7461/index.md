---
id: "cc746139-c4ca-4b97-97bf-eb0772786707"
level: "task"
title: "Address relationship issues (3 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-10T00:32:45.761Z"
completedAt: "2026-03-10T00:36:10.402Z"
resolutionType: "config-override"
resolutionDetail: "Removed dead cross-zone re-export from shared/index.ts, pinned all 7 messaging files + 7 test files to viewer-message-pipeline zone, and separated landing.ts into dedicated web-landing zone"
acceptanceCriteria: []
description: "- The 4 cross-zone imports from web-viewer into web-shared are traceable to the shared/request-dedup.ts duplicate — resolving the duplication would collapse this cross-zone edge entirely, reducing coupling between web-viewer and web-shared to zero.\n- message zone depends on files in viewer-message-pipeline that logically belong in web-viewer; resolving the zone misclassification will redirect this import edge and may expose a latent zone-level cycle between message and web-viewer that is currently hidden by the misclassification.\n- Production file packages/web/src/landing/landing.ts co-zones with test and script files — zone health metrics conflate production and test code, masking any real production-side structural issues."
recommendationMeta: "[object Object]"
---

# Address relationship issues (3 findings)

🟠 [completed]

## Summary

- The 4 cross-zone imports from web-viewer into web-shared are traceable to the shared/request-dedup.ts duplicate — resolving the duplication would collapse this cross-zone edge entirely, reducing coupling between web-viewer and web-shared to zero.
- message zone depends on files in viewer-message-pipeline that logically belong in web-viewer; resolving the zone misclassification will redirect this import edge and may expose a latent zone-level cycle between message and web-viewer that is currently hidden by the misclassification.
- Production file packages/web/src/landing/landing.ts co-zones with test and script files — zone health metrics conflate production and test code, masking any real production-side structural issues.

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-03-10T00:32:45.761Z
- **Completed:** 2026-03-10T00:36:10.402Z
- **Duration:** 3m
