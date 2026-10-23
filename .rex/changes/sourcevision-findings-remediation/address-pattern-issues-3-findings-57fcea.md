---
id: "57fcea74-4eb1-4867-9e7f-b4a59c743b77"
type: "task"
title: "Address pattern issues (3 findings)"
slug: "address-pattern-issues-3-findings-57fcea"
description: "- Outbound coupling (5 edges out) exceeds inbound coupling (4 edges in) for a module named 'pipeline' — utilities that act as infrastructure typically have higher fan-in than fan-out. The reverse ratio here may indicate the messaging zone has absorbed dependencies that belong in its callers.\n- Production entrypoint (landing.ts) co-located in a zero-cohesion residual zone inflates production-file count for a zone with otherwise no production code — automated health reports cannot distinguish between 'isolated production file' and 'isolated test artifact' without the pin.\n- web-viewer sub-zone acts as an undeclared hub (4 of 6 cross-zone edges touch it) without a gateway module to make that surface explicit and auditable. CLAUDE.md documents gateways for rex and sourcevision but not for the viewer-message-pipeline↔web-viewer interface."
priority: "high"
source: "sourcevision"
---
