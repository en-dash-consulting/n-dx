---
id: "fe8a5762-efea-45c6-bf57-2f220e61f3ea"
level: "task"
title: "Address relationship issues (7 findings)"
status: "completed"
priority: "critical"
source: "sourcevision"
startedAt: "2026-03-11T13:24:55.624Z"
completedAt: "2026-03-11T13:46:51.341Z"
resolutionType: "code-change"
resolutionDetail: "Fixed 2 code issues (crash-detection barrel re-export removal, BatchAcceptanceRecord type moved to core), fixed pre-existing stale cohesion exceptions, acknowledged 5 findings as type-only/zone-classification/stale"
acceptanceCriteria: []
description: "- crash-detection exports are aggregated by a performance barrel zone (viewer/performance/index.ts) before reaching web-viewer consumers — this intermediate aggregator is not documented in CLAUDE.md's four-zone topology and creates a hidden dependency on the performance zone's re-export contract.\n- The single reverse import from rex-prd-engine into prd-fix-command (1 edge) is the lowest-risk of the core→satellite inversions; if this edge is a type import it should be moved to an interface in the core to eliminate the inversion without breaking callers\n- rex-prd-engine imports from both chunked-review (2) and prd-fix-command (1), creating a partial inversion where the core domain layer depends on its satellite feature zones — violates standard layered architecture where cores should have no knowledge of their consumers\n- packages/web/src/server/routes-data.ts has 7 direct imports from web-viewer with no gateway mediation — it is the highest-coupling single file crossing the server/viewer boundary and should be the first candidate for a dedicated server-side adapter or type-projection layer if viewer types are refactored.\n- server-usage-scheduler emits 3 imports upward into web-dashboard-platform and 2 into viewer-message-pipeline; if any are runtime (non-type) imports this violates the intended downward-only service dependency flow.\n- Bidirectional import cycle between viewer-message-pipeline and web-dashboard-platform (16 in, 6 out) means neither zone can be loaded in isolation; extracting a thin shared-types layer would break the cycle.\n- web-dashboard-platform imports from web-unit (a test zone) — production code must never import test utilities; locate and remove the offending import immediately."
recommendationMeta: "[object Object]"
---
