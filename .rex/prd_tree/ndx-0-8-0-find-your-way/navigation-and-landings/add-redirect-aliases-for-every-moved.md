---
id: "e8fb5412-e393-4e24-a104-8b14194066d1"
level: "task"
title: "Add redirect aliases for every moved dashboard path and a navigation contract test"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "navigation-landings"
  - "pr-23"
blockedBy:
  - "22d013f6-b2f5-46e3-a335-91ae32d2e934"
source: "caos work management: WM-2114 (Add redirect aliases for every moved dashboard path and a navigation contract test); 0.8.0 planning, PR 23 · Navigation and landings"
acceptanceCriteria:
  - "/overview, /rex-dashboard, /graph, /iso-map, /zones, /architecture and /routes redirect to their new pages."
  - "A navigation contract test lists every view, deep-links each one and records zero console errors."
  - "The restored-views test still passes."
description: "Pages move and merge in 0.8.0, so every old path needs a redirect and a test must prove each view still deep-links.\n\nImplementation notes: Add an alias table in packages/web/src/shared/view-routing.ts (and shared/view-id.ts) consumed by viewer route parsing and by the server SPA catch-all in packages/web/src/server/routes-static.ts. The contract test belongs with the web e2e/integration tests and should be listed as a release gate. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-25T18:12:46.000Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
