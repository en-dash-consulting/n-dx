---
id: "9a09a196-c686-43a2-a55a-d463d36da077"
level: "task"
title: "Add an architecture-policy rule that rejects new literal .rex/, .hench/ and .sourcevision/ paths"
status: "completed"
priority: "medium"
tags:
  - "0.8.0"
  - "layout-resolver"
  - "pr-20"
blockedBy:
  - "f2d76fbb-559b-4008-bfe6-8166034c9b67"
  - "c64f053e-96ef-4fc9-a9b5-f27f0f9cc1f5"
source: "caos work management: WM-2154 (Add an architecture-policy rule that rejects new literal .rex/, .hench/ and .sourcevision/ paths); 0.8.0 planning, PR 20 · Layout resolver and path sweep"
startedAt: "2026-10-06T06:16:26.460Z"
completedAt: "2026-10-06T07:06:37.381Z"
endedAt: "2026-10-06T07:06:37.381Z"
resolutionType: "code-change"
resolutionDetail: "Cleared the last 24 literal .rex/ .hench/ .sourcevision/ sites across 13 files and turned that half of the policy into a wall with no inventory escape. Criterion 1 is met for the three directories; .n-dx* config literals (29 across 22 files) stay on the ratchet, which is a separate sweep. Real defect fixed en route: sv pr-markdown read the PRD through a fixed .rex and every failure there is a silent catch, so on a .ndx/ project it reported an empty PRD for a full one. Three attribution bugs of the same shape: rex analyze stamped proposals with .sourcevision/zones.json, and hench's reviewer was told to list .rex/prd_tree/ before capturing, so the listing came back empty and duplicates got filed. New API: packages/web/src/viewer/state-paths.ts, a browser-safe twin of layoutStateNames() (layout.ts imports node:fs and cannot be bundled), pinned by layout-resolver-contract.test.js; CANONICAL_MARKDOWN_SOURCE_PATH in rex so the status bucket key and the attribution prefix come from one constant. Two documented ALLOWED entries: that twin, and LEGACY_SOURCE_FILE_PREFIX (a value in data on disk, not a constructed path). Detector self-test now floors files visited rather than literals found, so it keeps its teeth once the debt is zero."
acceptanceCriteria:
  - "No literal .rex/, .hench/ or .sourcevision/ path exists outside the resolver and the migration command (policy test)."
  - "The rule fails with the file and line of any new literal."
description: "Once every package uses the resolver, stop new literals from creeping back in.\n\nImplementation notes: Add the rule to tests/e2e/architecture-policy.test.js with an explicit allow-list for the resolver, paths modules and the migrate-layout command. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-10-06T07:06:37.833Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
