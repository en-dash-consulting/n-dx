---
id: "2d8ffe0a-fcc5-4d75-935d-796143e719ed"
level: "task"
title: "Regenerate the 0.8.0 documents, run the navigation contract and compare pages against the wireframes"
status: "pending"
priority: "high"
tags:
  - "0.8.0"
  - "release-readiness"
  - "pr-26"
blockedBy:
  - "e8fb5412-e393-4e24-a104-8b14194066d1"
  - "38679536-98a9-4236-b92d-b4500e4b08f3"
  - "e2969878-03e8-4ebf-8f6a-99279cf7f04d"
  - "343f075c-2314-4861-80d1-7b5e53e56861"
source: "caos work management: WM-2159 (Regenerate the 0.8.0 documents, run the navigation contract and compare pages against the wireframes); 0.8.0 planning, PR 26 · Release readiness"
acceptanceCriteria:
  - "The three documents are regenerated in the release pull request."
  - "The required tests, boundary tests and navigation contract pass on the release commit."
  - "Wireframe differences are listed in this task."
description: "Regenerate docs/cli-ui-gap.md, the viewer architecture document and the README command reference; run the navigation contract; compare each shipped page against its wireframe and record the differences in this task rather than dropping them.\n\nImplementation notes: docs/cli-ui-gap.md comes from the command manifest; docs/architecture/viewer-architecture.md and the README command reference (packages/core/readme-generator.js) are regenerated. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-10-02T17:01:57.390Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
