---
id: "a9047032-1cca-4472-80e5-5a280792cb8a"
level: "task"
title: "Keep automatic dry runs from writing task claims"
status: "pending"
priority: "medium"
tags:
  - "pr-06"
  - "claims"
  - "hench"
  - "ndx-adversarial-review"
  - "severity:medium"
blockedBy:
  - "25921948-0b6a-4750-bcbf-c90d1d04d220"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "An automatically selected CLI dry run excludes tasks claimed by another live process without acquiring its own claim."
  - "An automatic dry run leaves an absent claims file absent and does not rewrite an existing claims file."
  - "The dry-run regression test fails if brief preparation claims before taking the dry-run return path."
description: "Severity: medium. Verdict: should-fix before release. In `packages/hench/src/agent/lifecycle/cli-loop.ts`, the automatic path calls `prepareBrief` with `projectDir` before it returns for `dryRun`; `prepareBrief` then acquires a claim. The outer lifecycle eventually releases it, but a dry run can create or rewrite `.git/ndx/claims.json` and briefly interfere with another selector. Carry dry-run intent into brief preparation so it still excludes claims held by others but never acquires or writes claim state. This depends on the API-path context work because both tasks refine the same shared claim-entry boundary."
lastModified: "2026-09-16T14:25:22.735Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
