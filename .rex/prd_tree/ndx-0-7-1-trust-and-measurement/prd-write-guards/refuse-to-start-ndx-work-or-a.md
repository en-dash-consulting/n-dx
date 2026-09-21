---
id: "fe4714da-0b3f-492f-b1b1-5fd4695734df"
level: "task"
title: "Refuse to start ndx work or a dashboard Execute on a non-conformant PRD tree"
status: "pending"
priority: "high"
tags:
  - "0.7.1"
  - "prd-write-guards"
  - "wm-2082"
source: "caos work management: WM2082 (Refuse to start ndx work or a dashboard Execute on a non-conformant PRD tree); guards PR, front of 0.7.1 wave 1"
acceptanceCriteria:
  - "Integration test: ndx work against a fixture with one non-conformant path exits non-zero before any claim is taken or file written, and the message names rex migrate-slugs."
  - "The Execute route on the same fixture returns an error status with the same message and the viewer shows it; a conformant tree runs as before."
  - "--dry-run shows the refusal."
  - "The hench and web rex gateways export the check, the architecture-policy ceiling is raised by exactly those exports, and existing hench integration tests pass."
description: "An autonomous run writes the PRD when it completes its task, so a run started with a mismatched build is exactly how a sweep ends up inside a feature pull request under a 'task completed' message. Before hench claims a task (packages/hench/src/cli/commands/run.ts, ahead of the claims and --allow-dirty gates), check the tree with findNonConformingSlugs through the hench rex gateway; if any path fails, exit non-zero with the count, the first few paths and the rex migrate-slugs instruction, and write nothing. Apply the same check in the dashboard's Execute route (packages/web/src/server/routes-hench.ts) so it answers with an error the viewer shows as a banner instead of starting a run. Include --dry-run, so the preview shows the refusal too. No override flag: a sweep is never acceptable inside a run, and the fix is always rex migrate-slugs on the default branch.\n\nImplementation notes: Export findNonConformingSlugs (and its result type) from rex's public surface if not already, and re-export it through packages/hench/src/prd/rex-gateway.ts and packages/web/src/server/rex-gateway.ts, raising the export ceiling in tests/e2e/architecture-policy.test.js by the exports added. In packages/hench/src/cli/commands/run.ts add a pre-run gate, before TaskClaims.forProject and the --allow-dirty check, that loads the tree, runs the check and on any result throws a CLIError with the count, up to three paths and 'run rex migrate-slugs on the default branch'; make it apply to --dry-run. In packages/web/src/server/routes-hench.ts run the same check in the Execute handler and answer 412 with the message; render it as a banner on the run card in the viewer. Add an integration test under packages/hench/tests/integration using a fixture tree with one re-suffixed path, and a web unit test for the route. Changesets: @n-dx/hench patch, @n-dx/web patch, @n-dx/rex patch if the export is new. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-21T18:55:28.837Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
