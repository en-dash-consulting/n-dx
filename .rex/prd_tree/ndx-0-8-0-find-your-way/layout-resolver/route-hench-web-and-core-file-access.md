---
id: "c64f053e-96ef-4fc9-a9b5-f27f0f9cc1f5"
level: "task"
title: "Route hench, web and core file access through their paths modules"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "layout-resolver"
  - "pr-20"
blockedBy:
  - "1ee864bc-c873-48a1-aedd-657448c3a5e1"
source: "caos work management: WM-2153 (Route hench, web and core file access through their paths modules); 0.8.0 planning, PR 20 · Layout resolver and path sweep"
acceptanceCriteria:
  - "No literal .rex/, .hench/ or .sourcevision/ path remains in hench, web or core outside the resolver and paths modules."
  - "hench, web and core test suites pass on both layouts."
description: "Replace literal .rex/, .hench/ and .sourcevision/ paths in hench, web and core with the resolver or the package paths modules.\n\nImplementation notes: hench and web reach rex and sourcevision paths only through their gateways (hench src/prd/rex-gateway.ts; web src/server/rex-gateway.ts and domain-gateway.ts); packages/core orchestration uses the core resolver. Watch the export ceiling in tests/e2e/architecture-policy.test.js when adding gateway exports. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-25T18:12:46.000Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
