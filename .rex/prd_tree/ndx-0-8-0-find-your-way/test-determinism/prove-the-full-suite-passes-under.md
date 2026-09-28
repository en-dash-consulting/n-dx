---
id: "45bb2888-01fe-49b7-b06b-079c16491ec9"
level: "task"
title: "Prove the full suite passes under concurrent build load three times in a row"
status: "in_progress"
priority: "medium"
tags:
  - "0.8.0"
  - "test-determinism"
  - "pr-16"
blockedBy:
  - "2098655c-94ac-489b-a012-c6db319d8767"
  - "26ce64cf-a0e4-4ac7-ad61-92973dce3b96"
  - "74d203ab-e6c5-49c4-a73f-3c9116257734"
  - "518ece53-aad7-4902-a899-9de45f6635d8"
source: "caos work management: WM-2146 (Prove the full suite passes under concurrent build load three times in a row); 0.8.0 planning, PR 16 · Test determinism"
startedAt: "2026-09-28T18:27:24.943Z"
acceptanceCriteria:
  - "The full suite passes under concurrent build load three times in a row; the runs and load method are recorded in the task."
description: "Closing check for Test determinism once the four clock-bound fixes land: a red test gate should mean the code is wrong, not that the machine was busy.\n\nImplementation notes: Run pnpm test three times while a concurrent pnpm build runs; record commit, machine and results. File a new task for any failure rather than rerunning until green. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-28T19:48:48.613Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
