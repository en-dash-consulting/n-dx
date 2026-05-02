---
id: "f8e698df-c2d9-462f-ba04-84e2e8395907"
level: "task"
title: "Address move-file issues (2 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-09T23:58:18.892Z"
completedAt: "2026-03-10T00:14:27.306Z"
resolutionType: "code-change"
resolutionDetail: "Fixed move-file analyzer to exclude test files from majority directory computation in pin divergence detection. Both findings were false positives caused by test files outnumbering source files in pinned zones."
acceptanceCriteria: []
description: "- File \"packages/web/src/viewer/messaging/call-rate-limiter.ts\" is pinned to zone \"Viewer Message Pipeline\" but lives in packages/web/src/viewer/messaging/ — consider moving to packages/web/tests/unit/viewer/ to align physical location with architectural zone\n- File \"packages/web/src/server/domain-gateway.ts\" is pinned to zone \"Web Dashboard\" but lives in packages/web/src/server/ — consider moving to packages/web/tests/unit/viewer/ to align physical location with architectural zone"
recommendationMeta: "[object Object]"
---

# Address move-file issues (2 findings)

🟠 [completed]

## Summary

- File "packages/web/src/viewer/messaging/call-rate-limiter.ts" is pinned to zone "Viewer Message Pipeline" but lives in packages/web/src/viewer/messaging/ — consider moving to packages/web/tests/unit/viewer/ to align physical location with architectural zone
- File "packages/web/src/server/domain-gateway.ts" is pinned to zone "Web Dashboard" but lives in packages/web/src/server/ — consider moving to packages/web/tests/unit/viewer/ to align physical location with architectural zone

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-03-09T23:58:18.892Z
- **Completed:** 2026-03-10T00:14:27.306Z
- **Duration:** 16m
