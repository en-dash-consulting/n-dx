---
id: "f2d76fbb-559b-4008-bfe6-8166034c9b67"
level: "task"
title: "Route rex and sourcevision file access through their paths modules"
status: "completed"
priority: "medium"
tags:
  - "0.8.0"
  - "layout-resolver"
  - "pr-20"
blockedBy:
  - "1ee864bc-c873-48a1-aedd-657448c3a5e1"
source: "caos work management: WM-2152 (Route rex and sourcevision file access through their paths modules); 0.8.0 planning, PR 20 · Layout resolver and path sweep"
startedAt: "2026-09-29T13:34:26.877Z"
completedAt: "2026-09-29T14:17:50.500Z"
endedAt: "2026-09-29T14:17:50.500Z"
resolutionType: "code-change"
resolutionDetail: "Routed every rex and sourcevision path construction through the paths modules. Deleted REX_DIR and SV_DIR; ~120 `join(dir, <DIRNAME>)` sites now call resolveRexPaths / resolveSourcevisionPaths (or resolveLayout for another tool's directory). Three display strings moved from fixed text to the resolved location: the migration banner, `rex export`'s refusal, and the narration log path. `src/export/` keeps a hand-written twin (analysisDirFor) because it bundles into the dependency-free iso skill; pinned by the layout-resolver contract test. New per-layout integration tests in both packages; full suite 6/6."
acceptanceCriteria:
  - "No literal .rex/ or .sourcevision/ path remains in packages/rex/src or packages/sourcevision/src outside the paths modules."
  - "rex and sourcevision test suites pass on both layouts."
description: "Replace literal .rex/ and .sourcevision/ paths in rex and sourcevision with their paths modules.\n\nImplementation notes: Mechanical replacement guided by grep; keep PRD_TREE_DIRNAME, TREE_META_FILENAME and prdLockPath in packages/rex/src/store/paths.ts as the single source. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-29T14:17:52.487Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
