---
id: "109638b1-0eda-425d-a785-f2b87ecf6904"
level: "task"
title: "Address observation issues (5 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-09T00:30:23.465Z"
completedAt: "2026-03-09T00:48:14.440Z"
acceptanceCriteria: []
description: "- Bidirectional coupling: \"hench-agent-2\" ↔ \"web-dashboard\" (4+3 crossings) — consider extracting shared interface\n- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 24 files — high-impact module, changes may have wide ripple effects\n- High coupling (0.67) — 4 imports target \"web-dashboard\"\n- Low cohesion (0.33) — files are loosely related, consider splitting this zone\n- 11 entry points — wide API surface, consider consolidating exports\n\n---\n\n- Bidirectional coupling: \"dashboard-mcp-server\" ↔ \"web-package-shell\" (2+4 crossings) — consider extracting shared interface\n- The task-usage-tracking ↔ dashboard-mcp-server coupling cycle is the only inter-zone warning in this batch and should be resolved to preserve clean unidirectional data flow in the analytics subsystem.\n- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 22 files — high-impact module, changes may have wide ripple effects\n- Bidirectional imports between this zone and dashboard-mcp-server (2 imports in each direction) create a coupling cycle; consider inverting the dependency or introducing an event/callback boundary.\n- Coupling of 0.5 driven by 6 imports from dashboard-mcp-server suggests this cluster is a natural sub-module of that zone rather than an independent architectural boundary."
recommendationMeta: "[object Object]"
---
