---
id: "6acec1b3-ff5e-4e3b-9cef-1710bc724108"
level: "task"
title: "Write the 0.8.0 release note and confirm per-package tags and GitHub releases after publish"
status: "pending"
priority: "high"
tags:
  - "0.8.0"
  - "release-readiness"
  - "pr-26"
blockedBy:
  - "25578b67-51d9-4764-a2d1-5342ab68f4b5"
  - "2d8ffe0a-fcc5-4d75-935d-796143e719ed"
source: "caos work management: WM-2160 (Write the 0.8.0 release note and confirm per-package tags and GitHub releases after publish); 0.8.0 planning, PR 26 · Release readiness"
acceptanceCriteria:
  - "The release note lists every redirect added and every new configuration key."
  - "After the publish, every package has a 0.8.0 git tag and a GitHub release."
description: "0.8.0 ships with a release note matching what was built.\n\nImplementation notes: Collect redirects from the alias table in packages/web/src/shared/view-routing.ts and config keys from the merged changesets. 0.7.1 fixed the release plumbing so a publish creates one git tag and one GitHub release per package; confirm it happened for every package. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-25T18:12:46.000Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
