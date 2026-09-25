---
id: "563aace2-25a9-4f53-b754-560c2da6bb06"
level: "task"
title: "Detect an index.md whose Children table omits a child directory, after confirming whether it hides items"
status: "pending"
priority: "medium"
tags:
  - "0.7.1"
  - "prd-write-guards"
  - "pr-j4"
  - "audit-2026-09-23"
source: "0.7.1 execution plan status 2026-09-23 (uncaptured follow-up) and the 0.7.1 release audit"
acceptanceCriteria:
  - "A fixture test records whether a child directory missing from its parent's Children table survives a load followed by a full-tree save."
  - "If the child does not survive, rex validate --post-merge reports the shape as needing manual intervention, so the #396 CI gate fails on it."
  - "If the child survives, rex validate --post-merge reports the table as repairable (out of sync), and the task's resolution records that the shape is cosmetic."
description: "`testing-documentation/make-test-results-independent-of` reached `main` with its `index.md` present but four children missing from its Children table. PRs #394 and #395 each repaired it by hand. The execution plan says items hidden this way are invisible to the loader and deleted by the next full-tree save. `rex validate --post-merge` reports nothing for this shape: `post-merge-validate.ts` has no issue class for it, so the #396 CI gate cannot catch it.\n\nThe audit found that `folder-tree-parser.ts:13` treats the Children table as informational and directory nesting as authoritative, which would make the shape cosmetic. Settle that first: build a fixture whose feature `index.md` omits one child from its table, load it, save the full tree, and check whether the child survives.\n\nConstraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-23T18:40:21.653Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
