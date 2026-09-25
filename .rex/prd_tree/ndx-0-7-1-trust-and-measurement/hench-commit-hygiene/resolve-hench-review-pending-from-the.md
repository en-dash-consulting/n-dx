---
id: "c7585f76-0960-492b-8fe7-8414afe0f449"
level: "task"
title: "Resolve hench review pending from the project's review directory rather than the stored absolute report path"
status: "pending"
priority: "low"
tags:
  - "0.7.1"
  - "hench-commit-hygiene"
  - "pr-c"
  - "audit-2026-09-23"
source: "0.7.1 release audit 2026-09-23 (main @ ee165780)"
acceptanceCriteria:
  - "hench review pending looks for the report under the current project's .hench/reviews/ first, and falls back to the stored reportPath only when that file is absent."
  - "Unit test: a run record whose reportPath points into a moved project directory still lists its pending findings."
  - "The comment at review.ts:95 describes the actual behaviour."
description: "`hench review pending <run>` (PR L, #389) prefers the absolute `reportPath` stored on the run record (`packages/hench/src/cli/commands/review.ts:95`). The comment there says this protects moved projects, but it does the opposite: after a move the stored path is stale and the command errors.\n\nConstraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR.\n\nNOTE (0.7.1 close-out, 2026-09-25): not delivered by #404. PR C's only change to packages/hench/src/cli/commands/review.ts was an 8-line TODO comment; the code still resolves `run.review.reportPath || reviewReportPath(henchDir, run.id)`, preferring the stored absolute path, so a moved project still fails with \"Could not read the review report\". Left: resolve reviewReportPath(henchDir, run.id) first and fall back to the stored path, add the moved-project unit test, and correct the comment above that line. Not in 0.7.1; this task stays pending, so the Hench commit hygiene feature stays pending."
lastModified: "2026-09-25T16:45:51.338Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
