---
id: "1f746194-8a84-4cf7-83bb-ffd828003a8b"
level: "task"
title: "Address pattern issues (4 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-09T00:48:56.375Z"
completedAt: "2026-03-09T00:56:40.126Z"
acceptanceCriteria: []
description: "- architecture-policy.test.js acts as a global zone guardian from within the cli-e2e-tests zone, creating an implicit dependency on the correctness of every other zone's import structure. If a new tier boundary rule is added to CLAUDE.md but not to this test, the rule is documentation-only with no enforcement path.\n- The cross-package-integration-tests zone has no coupling to production code, but it implicitly monitors every zone's import graph. As new zones or packages are added, this zone must be actively extended — currently there is no automated mechanism to detect when a new cross-package import path is created without a corresponding contract test.\n- The residual 17-file zone merges files from three distinct semantic domains into one zone with misleading metrics (cohesion 0.33, coupling 0.67) — the coupling score is a detection artifact that will resolve once zone hints reclassify the files to their correct zones.\n- web-dashboard and hench are the two largest production zones (388 vs 155 files) and both connect upstream to rex via dedicated gateway files. This creates a fan-in topology where rex is the central domain — if rex's public API changes, two independent gateways must be updated simultaneously, which is a coordination risk as the codebase scales."
recommendationMeta: "[object Object]"
---
