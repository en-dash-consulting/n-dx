---
id: "169b6a3b-5fd8-446e-a84c-858222530b72"
level: "task"
title: "Fix structural in viewer-ui-hub: Bidirectional 74-edge coupling with Web Dashboard Platform is the largest cross- (+1 more)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-19T03:00:16.803Z"
completedAt: "2026-04-19T03:05:51.303Z"
resolutionType: "code-change"
resolutionDetail: "Added viewer-ui-hub gateway compliance guard to boundary-check.test.ts. Two rules: (1) ui-hub components must import cross-zone via api.js, not leaf hook/type reaches; (2) external files must use components/index.ts barrel. CLAUDE.md documentation was already complete from a prior session."
acceptanceCriteria: []
description: "- Bidirectional 74-edge coupling with Web Dashboard Platform is the largest cross-zone relationship in the web package — a periodic audit of import direction and gateway compliance would reduce risk of eroding the viewer↔server boundary.\n- Zone meets both dual-fragility thresholds (cohesion 0.38 < 0.4, coupling 0.63 > 0.6). As the intentional viewer composition hub, this is structurally expected, but the zone should be baseline-documented in the CLAUDE.md fragility governance table alongside web-shared and rex-cli."
recommendationMeta: "[object Object]"
---
