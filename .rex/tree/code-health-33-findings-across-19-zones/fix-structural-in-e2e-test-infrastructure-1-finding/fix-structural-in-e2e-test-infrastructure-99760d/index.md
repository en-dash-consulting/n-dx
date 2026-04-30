---
id: "99760deb-ff19-46cf-8460-a302f201338e"
level: "task"
title: "Fix structural in e2e-test-infrastructure: Production entry points (assistant-assets/index.js, packages/core/assistant-inte"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-18T15:10:13.973Z"
completedAt: "2026-04-18T15:15:50.116Z"
resolutionType: "config-override"
resolutionDetail: "Added zone pins in .n-dx.json for assistant-assets/index.js, packages/core/assistant-integration.js, claude-integration.js, and codex-integration.js → core zone, separating them from the e2e test zone."
acceptanceCriteria: []
description: "- Production entry points (assistant-assets/index.js, packages/core/assistant-integration.js) are grouped into the same zone as test files, suggesting community detection is coupling asset-generation scripts to the test suite via shared import paths."
recommendationMeta: "[object Object]"
---
