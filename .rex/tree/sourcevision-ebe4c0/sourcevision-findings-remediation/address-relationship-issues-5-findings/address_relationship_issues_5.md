---
id: "b2140cd8-dd60-4fed-ba39-74c0eb3f5d59"
level: "task"
title: "Address relationship issues (5 findings)"
status: "completed"
priority: "critical"
source: "sourcevision"
startedAt: "2026-03-06T23:54:01.595Z"
completedAt: "2026-03-06T23:58:53.657Z"
acceptanceCriteria: []
description: "- Hench is the only execution-layer package importing from a domain package (rex via gateway); if rex's public API changes, hench's gateway is the single choke-point — this is good design, but the gateway has no explicit version-lock or compatibility test to catch breaking changes early.\n- Cross-zone import direction 'dom → web-viewer' conflicts with documented leaf-node status; verify whether dom-performance-monitoring imports anything from web-viewer or whether the arrow direction in the import table denotes 'exports to'. If dom does import from web-viewer, this is a circular dependency that must be resolved.\n- Orchestration layer's zero-coupling guarantee is enforced structurally but not contractually — CLI argument interfaces between cli.js and domain package CLIs are untyped; adding schema validation or contract tests would make the spawn boundary explicit.\n- viewer-static-assets has zero import-graph coupling but carries hidden deployment coupling to web-dashboard via build manifest filenames; this contract is not enforced by TypeScript and breaks silently if build output names change.\n- boundary-check.test.ts appears to test zone-boundary contracts rather than websocket internals; relocating it to an integration test zone would remove the external coupling that degrades this zone's cohesion score."
recommendationMeta: "[object Object]"
---
