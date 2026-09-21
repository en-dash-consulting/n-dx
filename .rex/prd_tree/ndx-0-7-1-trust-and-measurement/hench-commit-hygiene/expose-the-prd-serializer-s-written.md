---
id: "9eaa9ac9-a4ff-47bf-89d6-4c15542a7200"
level: "task"
title: "Expose the PRD serializer's written and deleted file list through the rex gateway"
status: "pending"
priority: "medium"
tags:
  - "0.7.1"
  - "hench-commit-hygiene"
  - "wm-2039"
source: "caos work management: WM2039 (Expose the PRD serializer's written and deleted file list through the rex gateway); 0.7.1 execution plan PR group"
acceptanceCriteria:
  - "rex's public API returns, for every store save, the repository-relative paths written and deleted."
  - "The hench rex-gateway re-exports the type and access function; tests/e2e/architecture-policy.test.js's export ceiling is updated by exactly the exports added and the count is justified in the test."
  - "Unit tests in rex cover written, deleted and unchanged (skipped by writeIfChanged) files."
description: "The PRD folder-tree serializer (packages/rex/src/store/folder-tree-serializer.ts) already knows exactly which files each save wrote and deleted, but hench cannot see that list: hench reaches rex only through packages/hench/src/prd/rex-gateway.ts, and the store's save result is not exported. Make the per-save file list part of rex's public surface and re-export it through the gateway so hench's completion commit can stage precisely those paths.\n\nImplementation notes: In packages/rex, make the result of a PRD store save carry the list of files written and files deleted (repository-relative paths), based on what folder-tree-serializer.ts's writeIfChanged and delete logic already computes; expose it from packages/rex/src/public.ts (or the store's public entry) and re-export the type and accessor from packages/hench/src/prd/rex-gateway.ts, which is the only file in hench allowed to import from @n-dx/rex. Raise the gateway export ceiling in tests/e2e/architecture-policy.test.js by the number of exports you add and update the justification comment. Add rex unit tests for written, deleted and unchanged files. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-21T17:24:11.905Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
