---
id: "873df8ca-5145-40fd-97b7-b3d8549ab6be"
level: "task"
title: "gateways.md names hench's v2 rex surfaces and its export ceiling"
status: "pending"
priority: "low"
tags:
  - "pr-35"
  - "review-2026-10-13"
  - "lane-hench"
source: "review-2026-10-13"
acceptanceCriteria:
  - "docs/architecture/gateways.md's hench row lists the v2 surfaces in packages/hench/src/prd/rex-gateway.ts and the ceiling architecture-policy.test.js enforces"
  - "Docs only; the instruction-alignment and architecture-policy tests pass"
description: "Holistic review of the combined v2 stack, 2026-10-13 (hygiene, nit). docs/architecture/gateways.md's hench row (the hench → rex gateway entry) was not updated for the v2 surfaces this PR adds to packages/hench/src/prd/rex-gateway.ts (prdLayout, isChangeLayerStore, findNextWorkTask, findActionableWork, resolveWorkById, completeV2Work, buildChangeBrief, V2Tree, enclosingChangeIds and the bookkeeping names) and does not state the export ceiling (65 on the integrated stack tip with #725; this PR's own count at its head). Docs only: rewrite the row to name the v2 surfaces it re-exports and the ceiling that tests/e2e/architecture-policy.test.js enforces at this PR's head."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-13T17:54:05.916Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
