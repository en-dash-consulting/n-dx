---
id: "95eb0e1e-8907-42de-9670-42db59857235"
level: "task"
title: "Print a preflight banner before interactive analyze, plan and recommend and a run summary after"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "command-transparency"
  - "pr-22"
blockedBy:
  - "38679536-98a9-4236-b92d-b4500e4b08f3"
source: "caos work management: WM-2123 (Print a preflight banner before interactive analyze, plan and recommend and a run summary after); 0.8.0 planning, PR 22 · Command effects manifest and terminal preflight"
acceptanceCriteria:
  - "ndx analyze without --yes prints the banner and pauses; with --yes or in autonomous mode it does not."
  - "--format=json output is unchanged (test)."
  - "The closing summary lists files written, LLM calls, tokens, cost and the next command."
  - "Plan and recommend report progress through the same reporter analyze uses."
description: "In the terminal, interactive analyze, plan and recommend show the command's declared effects and pause briefly, skipped by --yes and in autonomous modes, then print monotonic progress and a summary of files written, LLM calls, tokens, cost and the next command.\n\nImplementation notes: Render the banner from the effects declarations in packages/core (cli.js orchestration spawns the package CLIs; the banner is printed by the orchestrator before spawning). 0.7.1 (#414) shipped a shared monotonic progress reporter in llm-client, used today by analyze; plan and recommend must report through it rather than a second reporter. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-25T18:12:46.000Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
