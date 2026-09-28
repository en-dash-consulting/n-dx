---
id: "4e03d352-7ce5-4512-8ef4-b12f40307dc6"
level: "task"
title: "Point the PRD delta route and SourceVision's PR markdown at rex tree-diff and drop the legacy prd.md read"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "prd-storage-additive"
  - "pr-18"
blockedBy:
  - "8a850a37-48aa-483e-9829-4c9ca59723e0"
source: "caos work management: WM-2129 (Point the PRD delta route and SourceVision's PR markdown at rex tree-diff and drop the legacy prd.md read); 0.8.0 planning, PR 18 · PRD storage additive"
acceptanceCriteria:
  - "SourceVision's PR markdown produces a Completed Work section on a folder-tree project."
  - "The delta route and the CLI agree on the same fixture."
  - "No code path reads .rex/prd.md for PR markdown."
description: "The PRD delta route shipped in 0.7.0 and SourceVision's pull-request markdown should both call tree-diff, which replaces SourceVision's read of the legacy prd.md file. This is a live defect: on a folder-tree project SourceVision's PR markdown reads .rex/prd.md in packages/sourcevision/src/analyzers/branch-work-collector.ts, which no longer exists after migration, so its Completed Work section finds nothing.\n\nImplementation notes: Rewire packages/web/src/server/prd-delta.ts and routes-workspaces.ts to the rex diff via server/rex-gateway.ts; SourceVision must not import rex (domain packages never import each other), so its PR markdown obtains the diff by spawning rex tree-diff --json or receives it from the caller. The current read is in packages/sourcevision/src/analyzers/branch-work-collector.ts. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-25T18:12:46.000Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
