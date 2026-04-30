---
id: "6291b72e-8ea9-44b0-9028-9474ca8af4ea"
level: "task"
title: "Fix observation in viewer-ui-hub: High coupling (0.63) — 5 imports target \"web-viewer\" (+1 more)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-18T14:38:28.275Z"
completedAt: "2026-04-18T14:47:49.182Z"
resolutionType: "code-change"
resolutionDetail: "Fixed search-overlay.ts to import NavigateTo through api.ts gateway instead of directly from types.ts (leaf reach-in violation). Commit: 76116c37."
acceptanceCriteria: []
description: "- High coupling (0.63) — 5 imports target \"web-viewer\"\n- Low cohesion (0.38) — files are loosely related, consider splitting this zone"
recommendationMeta: "[object Object]"
---

# Fix observation in viewer-ui-hub: High coupling (0.63) — 5 imports target "web-viewer" (+1 more)

🟠 [completed]

## Summary

- High coupling (0.63) — 5 imports target "web-viewer"
- Low cohesion (0.38) — files are loosely related, consider splitting this zone

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-04-18T14:38:28.275Z
- **Completed:** 2026-04-18T14:47:49.182Z
- **Duration:** 9m
