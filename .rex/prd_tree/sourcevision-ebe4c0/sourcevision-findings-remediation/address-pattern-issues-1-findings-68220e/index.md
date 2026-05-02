---
id: "68220e26-1cc6-4d14-91e4-b3d621ad0d4f"
level: "task"
title: "Address pattern issues (1 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-11T02:39:44.888Z"
completedAt: "2026-03-11T02:45:13.132Z"
resolutionType: "config-override"
resolutionDetail: "Pinned 7 build-tool and static asset files (build.js, dev.js, package.json, tsconfig.json, vitest.config.ts, SourceVision-F.png, SourceVision.png) from viewer-shell-assets zone to a new web-package-assets zone via .n-dx.json zone pins. Also cleaned up stale pin for deleted packages/hench/src/shared/glob.ts and removed resolved KNOWN_VIOLATIONS entry for packages/rex/src/core/move.ts."
acceptanceCriteria: []
description: "- The zone contains both build-tool artifacts (build.js, dev.js, package.json) and runtime Preact components — two categories that should never share a zone boundary because build config changes and component changes have entirely different risk profiles."
recommendationMeta: "[object Object]"
---

# Address pattern issues (1 findings)

🟠 [completed]

## Summary

- The zone contains both build-tool artifacts (build.js, dev.js, package.json) and runtime Preact components — two categories that should never share a zone boundary because build config changes and component changes have entirely different risk profiles.

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-03-11T02:39:44.888Z
- **Completed:** 2026-03-11T02:45:13.132Z
- **Duration:** 5m
