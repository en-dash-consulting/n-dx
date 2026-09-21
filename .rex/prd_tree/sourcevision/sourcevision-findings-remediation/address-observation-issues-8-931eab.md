---
id: "931eabce-d252-4b60-9023-da5c8c0371a8"
level: "task"
title: "Address observation issues (8 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-07T00:37:55.245Z"
completedAt: "2026-03-07T00:49:35.754Z"
acceptanceCriteria: []
description: "- Bidirectional coupling: \"task-usage-tracking\" ↔ \"web-dashboard\" (1+3 crossings) — consider extracting shared interface\n- Bidirectional coupling: \"web-build-infrastructure\" ↔ \"web-dashboard\" (4+2 crossings) — consider extracting shared interface\n- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 22 files — high-impact module, changes may have wide ripple effects\n- Low cohesion (0.25) — files are loosely related, consider splitting this zone\n- Cohesion of 0.25 and coupling of 0.75 indicate significant structural fragmentation — likely caused by test files importing broadly from the rest of the web package.\n- Only 2 of 6 files are production source; the test-to-source ratio inflates coupling scores and suggests the zone boundary is defined by test co-location rather than domain cohesion.\n- The cleanup scheduler imports back into web-viewer (per cross-zone import graph), creating a dependency inversion — the scheduler should depend on an interface, not the viewer zone.\n- Bidirectional imports between web and web-viewer (web→web-viewer: 4, web-viewer→web: 2) create a soft cycle risk; extracting shared primitives into a dedicated shared zone would eliminate this."
recommendationMeta: "[object Object]"
---
