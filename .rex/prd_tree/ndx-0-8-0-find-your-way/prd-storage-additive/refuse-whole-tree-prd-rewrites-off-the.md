---
id: "bdaf93b2-4b1e-4fac-9189-f01229b46d08"
level: "task"
title: "Refuse whole-tree PRD rewrites off the default branch without --allow-on-branch"
status: "completed"
priority: "medium"
tags:
  - "0.8.0"
  - "prd-storage-additive"
  - "pr-18"
source: "caos work management: WM-2127 (Refuse whole-tree PRD rewrites off the default branch without --allow-on-branch); 0.8.0 planning, PR 18 · PRD storage additive"
startedAt: "2026-09-28T23:09:15.225Z"
completedAt: "2026-09-28T23:45:45.596Z"
endedAt: "2026-09-28T23:45:45.596Z"
resolutionType: "code-change"
resolutionDetail: "Added packages/rex/src/core/branch-guard.ts and wired it into reshape, reorganize, prune, import-bundle --replace, and the four migrate-* commands; updated hench's and web's already-consented migrate-slugs spawns to pass --allow-on-branch so their existing double-confirm flows keep working."
acceptanceCriteria:
  - "Each guarded command refuses on a feature branch in a test repository and proceeds with the flag."
  - "The refusal names the branch and the flag."
  - "A tree on the default branch behaves exactly as today."
description: "Whole-tree rewrites made on feature branches have ridden into main inside unrelated pull requests. reshape, reorganize, prune, the migrate commands and import-bundle --replace refuse off the default branch unless --allow-on-branch is passed.\n\nImplementation notes: Add one guard helper in packages/rex (beside core/git-utils.ts / store/branch-naming.ts) and call it from cli/commands/reshape.ts, reorganize.ts, prune.ts, import-bundle.ts and the migrate-* commands. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-28T23:45:45.954Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
