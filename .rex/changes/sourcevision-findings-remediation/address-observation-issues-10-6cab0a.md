---
id: "6cab0ad8-c7df-4ca4-b9e2-e6f6f275719d"
type: "task"
title: "Address observation issues (10 findings)"
slug: "address-observation-issues-10-6cab0a"
description: "- Bidirectional coupling: \"sourcevision-mcp-gateway\" ↔ \"web-dashboard\" (3+2 crossings) — consider extracting shared interface\n- Bidirectional coupling: \"viewer-message-pipeline\" ↔ \"web-dashboard\" (2+4 crossings) — consider extracting shared interface\n- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 24 files — high-impact module, changes may have wide ripple effects\n- High coupling (0.6) — 3 imports target \"web-dashboard\"\n- Zero cohesion is expected for a residual zone but the mix of production source (landing.ts), test files, and analysis scripts across different directories suggests several distinct file families that should be pinned to their logical home zones.\n- 11 entry points — wide API surface, consider consolidating exports\n- High coupling (0.7) — 2 imports target \"web-dashboard\"\n- Low cohesion (0.3) — files are loosely related, consider splitting this zone\n- Cohesion 0.3 and coupling 0.7 are warning-level metrics caused by zone misclassification: viewer source files and build infrastructure files have been grouped together by the Louvain algorithm but serve completely different architectural roles.\n- Files elapsed-time.ts, fetch-pipeline.ts, call-rate-limiter.ts, route-state.ts, tick-timer.ts, and task-audit.ts are viewer UI code and should be pinned to the web-viewer zone; build.js and dev.js should be pinned to web-dashboard to match the pattern documented in the developer hints."
priority: "high"
source: "sourcevision"
---
