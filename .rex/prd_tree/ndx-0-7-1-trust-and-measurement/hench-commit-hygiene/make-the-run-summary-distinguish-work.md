---
id: "330d78ad-0716-4ea7-b280-8fe8bfd00aa0"
level: "task"
title: "Make the run summary distinguish work failure from record failure and name the commits"
status: "completed"
priority: "medium"
tags:
  - "0.7.1"
  - "hench-commit-hygiene"
  - "wm-2087"
  - "pr-k"
source: "caos work management: WM2087 (Make the run summary distinguish work failure from record failure and name the commits); follow-up from the guards run 2026-09-22, PR group K"
startedAt: "2026-09-22T04:51:07.938Z"
completedAt: "2026-09-22T05:22:57.332Z"
endedAt: "2026-09-22T05:22:57.332Z"
acceptanceCriteria:
  - "The summary lists the commit SHAs and subjects the run created."
  - "Status and Summary lines agree in all three outcomes (tests for each)."
  - "'Changes: none' is printed only when no commit and no dirty file resulted from the run."
description: "The end-of-run summary can print 'Status: failed' beside 'Summary: Task complete, working tree clean', and 'Changes: none' while two commits have landed. It reads the run status only, so a bookkeeping failure looks like a failed task. The summary should name the commits the run produced and say which of three things happened: the work failed, the work succeeded and the record was committed, or the work succeeded and the record is still uncommitted.\n\nImplementation notes: In the run summary printer (packages/hench/src/cli/commands/run.ts or the lifecycle summary helper it calls), read the run outcome and the recordCommitPending field, list the commits made during the run (the lifecycle already records commit SHAs on the run record), and render one of three consistent blocks. Add unit tests with a fixture run record for each outcome. Changeset: @n-dx/hench patch. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-22T05:23:37.073Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
