---
id: "25578b67-51d9-4764-a2d1-5342ab68f4b5"
level: "task"
title: "Audit the 0.8.0 changesets and run the package vulnerability scan"
status: "in_progress"
priority: "high"
tags:
  - "0.8.0"
  - "release-readiness"
  - "pr-26"
source: "caos work management: WM-2158 (Audit the 0.8.0 changesets and run the package vulnerability scan); 0.8.0 planning, PR 26 · Release readiness"
startedAt: "2026-10-07T19:44:48.213Z"
acceptanceCriteria:
  - "changeset status is clean and the bump computes to a minor."
  - "The vulnerability scan result is recorded in the task with any accepted findings justified."
description: "Gate work for the 0.8.0 release: changesets use scoped package names with minor bumps where the epic calls for them, and the dependency vulnerability scan is clean or triaged. 0.7.1 left the dependency audit clean, so for 0.8.0 the scan confirms rather than fixes.\n\nImplementation notes: Review .changeset/*.md against the merged 0.8.0 pull requests; follow RELEASING.md. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-10-07T19:44:48.700Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
