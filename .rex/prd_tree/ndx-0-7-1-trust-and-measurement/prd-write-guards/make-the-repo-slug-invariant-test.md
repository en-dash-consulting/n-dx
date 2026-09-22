---
id: "24b06a30-3ff1-4ff4-af15-234ad907bd87"
level: "task"
title: "Make the repo slug invariant test import source and check the marker"
status: "pending"
priority: "medium"
tags:
  - "0.7.1"
  - "prd-write-guards"
  - "wm-2091"
  - "pr-j2"
source: "caos work management: WM2091 (Make the repo slug invariant test import source and check the marker); follow-up from the guards run 2026-09-22, PR group J2"
acceptanceCriteria:
  - "The test fails on a tree whose marker differs from SLUG_RULE_VERSION or is missing (fixture cases)."
  - "The test cannot pass against a stale dist: it imports source through the test loader, or asserts dist is newer than the serializer source."
  - "It still passes on main."
description: "tests/e2e/prd-slug-conformance.test.js (line 28) imports from packages/rex/dist/public.js, so a stale build asserts against the wrong rule, and it checks only findNonConformingSlugs, so a tree carrying a foreign or missing slugRule marker passes pnpm test while rex validate fails it. Import the rule from source (or fail loudly when dist is older than source) and assert that .rex/tree-meta.json carries slugRule equal to the build's SLUG_RULE_VERSION.\n\nImplementation notes: Change tests/e2e/prd-slug-conformance.test.js to import SLUG_RULE_VERSION and findNonConformingSlugs from the rex source entry the other e2e tests use (or add a guard comparing the mtime of packages/rex/dist/store/folder-tree-serializer.js with its source and failing with a 'rebuild' message when stale). Add assertions that .rex/tree-meta.json has slugRule === SLUG_RULE_VERSION. Add fixture cases for a wrong marker and a missing marker. No changeset (tests only). Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-22T02:48:01.315Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
