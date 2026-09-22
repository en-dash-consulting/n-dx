---
id: "05e58f79-5cc3-4c46-86c4-16ee85fadb77"
level: "task"
title: "Park deferred review findings as a pending-capture queue in autonomous mode"
status: "completed"
priority: "high"
tags:
  - "0.7.1"
  - "autonomous-review-capture"
  - "wm-2089"
  - "pr-l"
blockedBy:
  - "c4c54811-35f7-4015-9729-6ce876384501"
source: "caos work management: WM2089 (Park deferred review findings as a pending-capture queue in autonomous mode); follow-up from the guards run 2026-09-22, PR group L"
startedAt: "2026-09-22T17:35:15.236Z"
completedAt: "2026-09-22T17:52:51.689Z"
endedAt: "2026-09-22T17:52:51.689Z"
acceptanceCriteria:
  - "In autonomous mode no finding is dropped: each is recorded as deferred with its severity and text."
  - "The run's final output prints the deferred count and the review record path."
  - "`hench review pending <run>` (or the agreed command) lists deferred findings with ids the capture command accepts."
  - "Interactive mode still prompts exactly as before."
description: "The capture gate after an adversarial review requires an explicit user selection, but there is no user at the prompt inside an autonomous ndx work --review run, so every finding not auto-fixed is dropped and survives only in scrollback. Give autonomous runs a non-interactive disposition: findings that would have been offered are recorded as deferred (using the new disposition field), the end-of-run output prints how many were deferred and where they live, and a CLI command lists deferred findings for a run so the operator can capture them into the PRD afterwards. An ndx-level surface that lists pending findings across all runs is 0.8.0 command-transparency work.\n\nImplementation notes: In the review capture gate (packages/hench/src/agent/analysis/adversarial-review.ts and the lifecycle code that invokes it), detect non-interactive execution (the same signal --auto/--loop use for skipping prompts) and, instead of dropping unselected findings, record them with disposition 'deferred' via the new field. Print a one-line summary at the end of the run with the count and the record path. Add a `review pending <runId>` subcommand to the hench CLI that reads the record and lists deferred findings, and make the existing capture path accept those ids. Tests: autonomous run with findings records them all; interactive path unchanged; the CLI lists them. Changeset: @n-dx/hench patch. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-22T17:52:52.041Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
