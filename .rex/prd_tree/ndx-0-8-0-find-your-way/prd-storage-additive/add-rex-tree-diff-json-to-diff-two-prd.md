---
id: "8a850a37-48aa-483e-9829-4c9ca59723e0"
level: "task"
title: "Add rex tree-diff --json to diff two PRD trees"
status: "in_progress"
priority: "medium"
tags:
  - "0.8.0"
  - "prd-storage-additive"
  - "pr-18"
source: "caos work management: WM-2128 (Add rex tree-diff --json to diff two PRD trees); 0.8.0 planning, PR 18 · PRD storage additive"
startedAt: "2026-09-28T23:57:43.550Z"
acceptanceCriteria:
  - "tree-diff reports each category correctly on fixtures, including moves."
  - "Output includes each item's ancestor chain."
  - "Identical trees produce an empty diff."
description: "rex tree-diff --json diffs two trees (two commits, or a worktree against its anchor) into added, changed, completed, moved and removed items with their ancestors.\n\nImplementation notes: Add packages/rex/src/cli/commands/tree-diff.ts over the folder-tree parser (store/folder-tree-parser.ts); reuse the id-based diff approach in packages/web/src/server/prd-delta.ts rather than duplicating it, moving the core diff into rex and exporting it through the web rex-gateway. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-28T23:57:43.908Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
