---
id: "6cab0ad8-c7df-4ca4-b9e2-e6f6f275719d"
level: "task"
title: "Address observation issues (10 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-09T22:29:02.246Z"
completedAt: "2026-03-09T22:38:49.447Z"
resolutionType: "config-override"
resolutionDetail: "Pinned 4 web-ancillary files to web-dashboard to dissolve the residual zone. Added healthAnnotations for sourcevision-mcp-gateway (coupling 0.6) and web-dashboard (11 entry points). All 10 observation findings addressed through zone pins, health annotations, and acknowledgment of intentional architectural patterns."
acceptanceCriteria: []
description: "- Bidirectional coupling: \"sourcevision-mcp-gateway\" ↔ \"web-dashboard\" (3+2 crossings) — consider extracting shared interface\n- Bidirectional coupling: \"viewer-message-pipeline\" ↔ \"web-dashboard\" (2+4 crossings) — consider extracting shared interface\n- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 24 files — high-impact module, changes may have wide ripple effects\n- High coupling (0.6) — 3 imports target \"web-dashboard\"\n- Zero cohesion is expected for a residual zone but the mix of production source (landing.ts), test files, and analysis scripts across different directories suggests several distinct file families that should be pinned to their logical home zones.\n- 11 entry points — wide API surface, consider consolidating exports\n- High coupling (0.7) — 2 imports target \"web-dashboard\"\n- Low cohesion (0.3) — files are loosely related, consider splitting this zone\n- Cohesion 0.3 and coupling 0.7 are warning-level metrics caused by zone misclassification: viewer source files and build infrastructure files have been grouped together by the Louvain algorithm but serve completely different architectural roles.\n- Files elapsed-time.ts, fetch-pipeline.ts, call-rate-limiter.ts, route-state.ts, tick-timer.ts, and task-audit.ts are viewer UI code and should be pinned to the web-viewer zone; build.js and dev.js should be pinned to web-dashboard to match the pattern documented in the developer hints."
recommendationMeta: "[object Object]"
---

# Address observation issues (10 findings)

🟠 [completed]

## Summary

- Bidirectional coupling: "sourcevision-mcp-gateway" ↔ "web-dashboard" (3+2 crossings) — consider extracting shared interface
- Bidirectional coupling: "viewer-message-pipeline" ↔ "web-dashboard" (2+4 crossings) — consider extracting shared interface
- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 24 files — high-impact module, changes may have wide ripple effects
- High coupling (0.6) — 3 imports target "web-dashboard"
- Zero cohesion is expected for a residual zone but the mix of production source (landing.ts), test files, and analysis scripts across different directories suggests several distinct file families that should be pinned to their logical home zones.
- 11 entry points — wide API surface, consider consolidating exports
- High coupling (0.7) — 2 imports target "web-dashboard"
- Low cohesion (0.3) — files are loosely related, consider splitting this zone
- Cohesion 0.3 and coupling 0.7 are warning-level metrics caused by zone misclassification: viewer source files and build infrastructure files have been grouped together by the Louvain algorithm but serve completely different architectural roles.
- Files elapsed-time.ts, fetch-pipeline.ts, call-rate-limiter.ts, route-state.ts, tick-timer.ts, and task-audit.ts are viewer UI code and should be pinned to the web-viewer zone; build.js and dev.js should be pinned to web-dashboard to match the pattern documented in the developer hints.

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-03-09T22:29:02.246Z
- **Completed:** 2026-03-09T22:38:49.447Z
- **Duration:** 9m
