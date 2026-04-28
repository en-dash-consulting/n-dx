---
id: "b2140cd8-dd60-4fed-ba39-74c0eb3f5d59"
level: "task"
title: "Address relationship issues (5 findings)"
status: "completed"
priority: "critical"
source: "sourcevision"
startedAt: "2026-03-06T23:54:01.595Z"
completedAt: "2026-03-06T23:58:53.657Z"
description: "- Hench is the only execution-layer package importing from a domain package (rex via gateway); if rex's public API changes, hench's gateway is the single choke-point — this is good design, but the gateway has no explicit version-lock or compatibility test to catch breaking changes early.\n- Cross-zone import direction 'dom → web-viewer' conflicts with documented leaf-node status; verify whether dom-performance-monitoring imports anything from web-viewer or whether the arrow direction in the import table denotes 'exports to'. If dom does import from web-viewer, this is a circular dependency that must be resolved.\n- Orchestration layer's zero-coupling guarantee is enforced structurally but not contractually — CLI argument interfaces between cli.js and domain package CLIs are untyped; adding schema validation or contract tests would make the spawn boundary explicit.\n- viewer-static-assets has zero import-graph coupling but carries hidden deployment coupling to web-dashboard via build manifest filenames; this contract is not enforced by TypeScript and breaks silently if build output names change.\n- boundary-check.test.ts appears to test zone-boundary contracts rather than websocket internals; relocating it to an integration test zone would remove the external coupling that degrades this zone's cohesion score."
recommendationMeta: "[object Object]"
---

## Subtask: Verify dom→web-viewer cross-zone import direction is not circular

**ID:** `675369d2-f980-4c9e-a896-88c2dc2027f2`
**Status:** completed
**Priority:** high

Finding #2: Cross-zone import direction 'dom → web-viewer' conflicts with documented leaf-node status. Verify the import direction and document/resolve.

---

## Subtask: Add CLI spawn boundary contract tests

**ID:** `7b3f14af-c93a-4689-93e9-e91e7eec5cf6`
**Status:** completed
**Priority:** high

Finding #3: Orchestration layer's zero-coupling guarantee is enforced structurally but not contractually. Add contract tests that verify each domain CLI accepts the expected arguments and returns expected exit codes.

---

## Subtask: Add viewer build output contract assertion

**ID:** `86edb3ef-0410-4a4a-8397-39912054d8bb`
**Status:** completed
**Priority:** high

Finding #4: viewer-static-assets has hidden deployment coupling to web-dashboard via build manifest filenames. Add a contract test that verifies expected build outputs exist after build.

---

## Subtask: Relocate boundary-check.test.ts to integration tests

**ID:** `25667b78-01aa-401e-837f-c66c404646d2`
**Status:** completed
**Priority:** medium

Finding #5: boundary-check.test.ts tests zone-boundary contracts rather than websocket internals. Relocate to integration test directory to improve zone cohesion.

---
