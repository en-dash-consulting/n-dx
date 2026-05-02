---
id: "26791374-dca3-4403-973f-262a06d53fc2"
level: "task"
title: "Address move-file issues (1 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-11T02:24:16.188Z"
completedAt: "2026-03-11T02:25:32.834Z"
resolutionType: "code-change"
resolutionDetail: "Deleted dead duplicate packages/hench/src/shared/glob.ts — the canonical simpleGlobMatch lives in guard/paths.ts and is used by all consumers. The shared/ directory was removed as it had no other files."
acceptanceCriteria: []
description: "- File \"packages/hench/src/shared/glob.ts\" is pinned to zone \"Autonomous Agent Engine\" but lives in packages/hench/src/shared/ — consider moving to packages/hench/src/store/ to align physical location with architectural zone"
recommendationMeta: "[object Object]"
---

# Address move-file issues (1 findings)

🟠 [completed]

## Summary

- File "packages/hench/src/shared/glob.ts" is pinned to zone "Autonomous Agent Engine" but lives in packages/hench/src/shared/ — consider moving to packages/hench/src/store/ to align physical location with architectural zone

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-03-11T02:24:16.188Z
- **Completed:** 2026-03-11T02:25:32.834Z
- **Duration:** 1m
