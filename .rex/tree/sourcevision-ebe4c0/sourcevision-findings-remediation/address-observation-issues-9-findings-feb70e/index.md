---
id: "feb70ee4-ff40-44b3-9de8-7f912de340e6"
level: "task"
title: "Address observation issues (9 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-08T07:15:24.124Z"
completedAt: "2026-03-08T07:21:18.531Z"
acceptanceCriteria: []
description: "- 1 circular dependency chain detected — see imports.json for details\n- Bidirectional coupling: \"mcp-route-layer\" ↔ \"web-dashboard\" (3+2 crossings) — consider extracting shared interface\n- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 24 files — high-impact module, changes may have wide ripple effects\n- High coupling (0.6) — 3 imports target \"web-dashboard\"\n- Coupling of 0.6 is at the warning boundary; however, this is structurally necessary because routes-mcp.ts must bind to both the rex-gateway (runtime) and shared server types, making it the correct place for cross-package wiring.\n- Low cohesion (0.33) — files are loosely related, consider splitting this zone\n- Cohesion 0.33 and coupling 0.67 are warning-level; the root cause is viewer UI files misclassified into this zone rather than web-viewer — correcting zone hints or file placement will resolve both metrics.\n- 10 entry points — wide API surface, consider consolidating exports\n- One import flows from this zone back into web-dashboard, which inverts the expected dependency direction; verify that the imported symbol belongs in a shared types or constants module rather than in the consumer zone."
recommendationMeta: "[object Object]"
---

# Address observation issues (9 findings)

🟠 [completed]

## Summary

- 1 circular dependency chain detected — see imports.json for details
- Bidirectional coupling: "mcp-route-layer" ↔ "web-dashboard" (3+2 crossings) — consider extracting shared interface
- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 24 files — high-impact module, changes may have wide ripple effects
- High coupling (0.6) — 3 imports target "web-dashboard"
- Coupling of 0.6 is at the warning boundary; however, this is structurally necessary because routes-mcp.ts must bind to both the rex-gateway (runtime) and shared server types, making it the correct place for cross-package wiring.
- Low cohesion (0.33) — files are loosely related, consider splitting this zone
- Cohesion 0.33 and coupling 0.67 are warning-level; the root cause is viewer UI files misclassified into this zone rather than web-viewer — correcting zone hints or file placement will resolve both metrics.
- 10 entry points — wide API surface, consider consolidating exports
- One import flows from this zone back into web-dashboard, which inverts the expected dependency direction; verify that the imported symbol belongs in a shared types or constants module rather than in the consumer zone.

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-03-08T07:15:24.124Z
- **Completed:** 2026-03-08T07:21:18.531Z
- **Duration:** 5m
