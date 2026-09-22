---
id: "0afb583a-e40b-4fae-8879-7e88dc631ef6"
level: "task"
title: "Make the rollback prompt say what it reverts and default to restoring"
status: "pending"
priority: "medium"
tags:
  - "0.7.1"
  - "hench-commit-hygiene"
  - "wm-2086"
  - "pr-k"
source: "caos work management: WM2086 (Make the rollback prompt say what it reverts and default to restoring); follow-up from the guards run 2026-09-22, PR group K"
acceptanceCriteria:
  - "The prompt lists the files and says they are hench's status writes from this run."
  - "The default answer restores the pre-run PRD state; the destructive choice needs an explicit key."
  - "Unit test on the prompt text and default."
description: "After a failed record commit hench asks 'Revert N uncommitted file(s)? [y/N]'. The prompt never says the files are hench's own status reset, and its default, N, preserves the damage while y would have restored the correct status: inverted from what an operator expects. Once the companion item stops rolling back on record-commit failure the prompt appears only on genuine failure paths, so keep this change minimal: name the files and what reverting them restores, and default to the safe choice.\n\nImplementation notes: Find the revert prompt in packages/hench/src/agent/lifecycle/shared.ts (search for 'Revert' and 'uncommitted file'). Change the text to name the paths and say what they are, and flip the default so pressing Enter restores the pre-run state; make the destructive choice explicit. Add a unit test for the prompt string and the default mapping. Changeset: @n-dx/hench patch. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-22T02:47:35.626Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
