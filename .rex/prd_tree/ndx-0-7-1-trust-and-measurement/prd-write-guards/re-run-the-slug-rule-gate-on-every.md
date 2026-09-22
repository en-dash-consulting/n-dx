---
id: "98768036-0508-4f98-be42-85b94846dcf1"
level: "task"
title: "Re-run the slug-rule gate on every loop iteration"
status: "pending"
priority: "medium"
tags:
  - "0.7.1"
  - "prd-write-guards"
  - "wm-2090"
  - "pr-j2"
source: "caos work management: WM2090 (Re-run the slug-rule gate on every loop iteration); follow-up from the guards run 2026-09-22, PR group J2"
acceptanceCriteria:
  - "Integration test: a loop whose tree is made non-conformant between iterations refuses the next iteration before claiming, naming rex migrate-slugs."
  - "Single-task runs behave exactly as before."
  - "The per-iteration check adds no measurable time on this repository's tree (documented in the PR)."
description: "The slug-rule guard runs once, before the first task in cmdRun, and assertSlugRuleWritable (packages/rex/src/store/slug-rule-guard.ts around line 141) returns early on a matching marker without scanning paths. A long --loop or --epic-by-epic run that outlives a change to the tree (another worktree's write, a pull) is therefore unguarded after its first iteration, and a later iteration's completion write re-slugs whatever drifted. Run the gate at the start of every iteration in runLoop and runIterations, before the claim.\n\nImplementation notes: In packages/hench/src/agent/lifecycle (runLoop / runIterations) call the same pre-run slug gate used by cmdRun at the top of each iteration, ahead of TaskClaims and the --allow-dirty check. Add an integration test in packages/hench/tests/integration that renames one PRD file between iterations and asserts the refusal. Changeset: @n-dx/hench patch. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-22T02:48:00.416Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
