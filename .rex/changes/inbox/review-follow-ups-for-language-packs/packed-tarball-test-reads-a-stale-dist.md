---
id: "c3d4a3ef-bb41-4b4b-9dc7-a2ac11008c84"
type: "task"
title: "Packed-tarball test reads a stale dist, so a newly registered pack fails the gate"
slug: "packed-tarball-test-reads-a-stale-dist"
description: "packages/sourcevision/tests/e2e/packed-tarball.test.ts packs packages/sourcevision/dist as it is and asserts that every BUILTIN_PACKS entry reports structure mode. If dist predates a newly registered pack, the tarball lacks it and the test fails with a misleading diff ({java} vs {java, go}). Run bd67e84c (f817ad86, Go structure queries) failed its gate this way: dist/language/pack.js had no goPack. Terraform and SQL will hit it too."
acceptanceCriteria:
  - "packed-tarball.test.ts either builds sourcevision before packing, or fails first with a message saying dist is older than src/language/ and to run pnpm build"
  - "A pack registered in src but missing from dist never produces the mode-diff failure"
  - "The six static root policy tests pass"
priority: "medium"
tags:
  - "language-packs"
  - "sourcevision"
  - "test-gate"
source: "operator"
---
