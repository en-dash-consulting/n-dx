---
id: "921cf630-faac-4721-8415-13c38ea8ee57"
level: "task"
title: "Address observation issues (9 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-10T00:15:04.773Z"
completedAt: "2026-03-10T00:20:15.778Z"
resolutionType: "config-override"
resolutionDetail: "Pinned request-dedup.ts and its test to viewer-message-pipeline zone to dissolve the request-deduplication zone. Removed stale health annotation. All 9 findings addressed: 6 were already resolved by prior work (duplicate deletion, existing pins), 2 resolved by new pins, 1 acknowledged (fan-in hotspot by design)."
acceptanceCriteria: []
description: "- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 24 files — high-impact module, changes may have wide ripple effects\n- High coupling (0.65) — 2 imports target \"request-deduplication\"\n- Low cohesion (0.35) — files are loosely related, consider splitting this zone\n- Cohesion of 0.35 and coupling of 0.65 are warning-level indicators caused by mixing viewer UI utilities with build infrastructure in a single zone — applying zone pins to migrate viewer files into web-viewer and build scripts into web-dashboard will resolve both metrics.\n- Cohesion of 0.0 indicates this zone is a Louvain residual — the landing service, viewer tests, and analysis scripts share no imports; this is a candidate for zone dissolution via pins.\n- packages/web/src/landing/landing.ts is a production service file misclassified into a residual zone; pinning it to web-dashboard would give it accurate health tracking.\n- Coupling of 0.67 exceeds the 0.6 warning threshold and is a direct artifact of the duplication; resolving to one canonical copy is expected to bring coupling back below threshold.\n- Two RequestDedup implementations exist at src/shared/request-dedup.ts and src/viewer/messaging/request-dedup.ts; per CLAUDE.md the canonical location is viewer/messaging/ — the shared/ copy should be deleted and consumers redirected through external.ts.\n- Zone imports from both 'web-shared' (2) and 'web' (Viewer Message Pipeline, 3) while being imported by 'web-viewer' (4). The bidirectional relationship between 'message' and 'web' zones warrants a review to confirm no unintended circular dependency exists at the module level."
recommendationMeta: "[object Object]"
---
