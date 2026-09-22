---
id: "078cd2b1-3b60-4f22-a666-6ffa6bf22345"
level: "task"
title: "Check the slug-rule marker direction inside the PRD lock in adoptSlugRule"
status: "pending"
priority: "medium"
tags:
  - "0.7.1"
  - "prd-write-guards"
  - "wm-2094"
  - "pr-j2"
source: "caos work management: WM2094 (Check the slug-rule marker direction inside the PRD lock in adoptSlugRule); follow-up from the guards run 2026-09-22, PR group J2"
acceptanceCriteria:
  - "The marker read and direction check happen inside runTransaction, before any directory is created."
  - "A test with an injected concurrent marker write between the read and the lock shows the newer marker is preserved."
description: "adoptSlugRule in packages/rex/src/store/folder-tree-store.ts (around line 298) reads the marker before runTransaction acquires the PRD lock. A concurrent writer on a newer rule can record its marker in that window and have it overwritten, because the adopt path deliberately skips the write guard. Move the direction check inside the lock, still ahead of mkdir.\n\nImplementation notes: In packages/rex/src/store/folder-tree-store.ts move the tree-meta read and the version comparison in adoptSlugRule inside the runTransaction callback, before mkdir, so the decision is made under the lock. Add a unit test that writes a newer marker after the function is entered but before the lock is taken (inject via the store's test hooks or a fake lock) and asserts it survives. Changeset: @n-dx/rex patch. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-22T02:48:02.956Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
