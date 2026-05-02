---
id: "57fcea74-4eb1-4867-9e7f-b4a59c743b77"
level: "task"
title: "Address pattern issues (3 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-09T22:39:32.669Z"
completedAt: "2026-03-09T22:45:05.546Z"
resolutionType: "config-override"
resolutionDetail: "Addressed 3 pattern findings: (1) added healthAnnotation for viewer-message-pipeline explaining outbound>inbound coupling is expected for a composed integration layer; (2) added healthAnnotation for web-ancillary residual zone acknowledging landing.ts pin and zero-cohesion invariant; (3) declared external.ts as intra-package viewer↔server gateway in CLAUDE.md/CODEX.md gateway table, documenting the web-viewer hub surface."
acceptanceCriteria: []
description: "- Outbound coupling (5 edges out) exceeds inbound coupling (4 edges in) for a module named 'pipeline' — utilities that act as infrastructure typically have higher fan-in than fan-out. The reverse ratio here may indicate the messaging zone has absorbed dependencies that belong in its callers.\n- Production entrypoint (landing.ts) co-located in a zero-cohesion residual zone inflates production-file count for a zone with otherwise no production code — automated health reports cannot distinguish between 'isolated production file' and 'isolated test artifact' without the pin.\n- web-viewer sub-zone acts as an undeclared hub (4 of 6 cross-zone edges touch it) without a gateway module to make that surface explicit and auditable. CLAUDE.md documents gateways for rex and sourcevision but not for the viewer-message-pipeline↔web-viewer interface."
recommendationMeta: "[object Object]"
---

# Address pattern issues (3 findings)

🟠 [completed]

## Summary

- Outbound coupling (5 edges out) exceeds inbound coupling (4 edges in) for a module named 'pipeline' — utilities that act as infrastructure typically have higher fan-in than fan-out. The reverse ratio here may indicate the messaging zone has absorbed dependencies that belong in its callers.
- Production entrypoint (landing.ts) co-located in a zero-cohesion residual zone inflates production-file count for a zone with otherwise no production code — automated health reports cannot distinguish between 'isolated production file' and 'isolated test artifact' without the pin.
- web-viewer sub-zone acts as an undeclared hub (4 of 6 cross-zone edges touch it) without a gateway module to make that surface explicit and auditable. CLAUDE.md documents gateways for rex and sourcevision but not for the viewer-message-pipeline↔web-viewer interface.

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-03-09T22:39:32.669Z
- **Completed:** 2026-03-09T22:45:05.546Z
- **Duration:** 5m
