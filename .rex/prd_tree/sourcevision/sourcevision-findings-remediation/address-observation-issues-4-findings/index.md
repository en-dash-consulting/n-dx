---
id: "fb2f50df-9b43-48bc-8bcd-f6b985ecac23"
level: "task"
title: "Address observation issues (4 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-07T17:30:37.518Z"
completedAt: "2026-03-07T17:51:34.231Z"
acceptanceCriteria: []
description: "- Bidirectional coupling: \"web\" ↔ \"web-viewer\" (10+7 crossings) — consider extracting shared interface\n- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 22 files — high-impact module, changes may have wide ripple effects\n- High coupling (0.71) — 3 imports target \"web-viewer\"\n- Low cohesion (0.29) — files are loosely related, consider splitting this zone"
recommendationMeta: "[object Object]"
---

# Address observation issues (4 findings)

🟠 [completed]

## Summary

- Bidirectional coupling: "web" ↔ "web-viewer" (10+7 crossings) — consider extracting shared interface
- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 22 files — high-impact module, changes may have wide ripple effects
- High coupling (0.71) — 3 imports target "web-viewer"
- Low cohesion (0.29) — files are loosely related, consider splitting this zone

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-03-07T17:30:37.518Z
- **Completed:** 2026-03-07T17:51:34.231Z
- **Duration:** 20m
