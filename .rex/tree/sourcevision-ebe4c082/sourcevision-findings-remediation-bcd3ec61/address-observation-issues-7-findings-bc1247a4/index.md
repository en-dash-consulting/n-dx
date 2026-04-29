---
id: "bc1247a4-d914-4971-af3f-94cb56913989"
level: "task"
title: "Address observation issues (7 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-08T18:04:50.389Z"
completedAt: "2026-03-08T18:09:30.807Z"
acceptanceCriteria: []
description: "- Bidirectional coupling: \"task-usage-analytics\" ↔ \"web-dashboard\" (1+3 crossings) — consider extracting shared interface\n- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 24 files — high-impact module, changes may have wide ripple effects\n- Low cohesion (0.27) — files are loosely related, consider splitting this zone\n- Cohesion 0.27 is below the healthy threshold — this zone is an import-graph residual grouping unrelated files (build scripts, a hench store module, viewer UI components) that do not share a domain purpose.\n- Coupling 0.73 exceeds the high-coupling threshold — the cross-package mixing of hench and web files artificially inflates the boundary surface; resolving the misclassifications should bring coupling down significantly.\n- packages/hench/src/store/suggestions.ts is grouped with web package files despite belonging to the hench store layer — this misclassification should be corrected so the hench agent zone fully captures its own store.\n- 11 entry points — wide API surface, consider consolidating exports"
recommendationMeta: "[object Object]"
---
