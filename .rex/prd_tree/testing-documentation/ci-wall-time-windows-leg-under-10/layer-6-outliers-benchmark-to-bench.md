---
id: "10fe7012-c448-40f4-8a7a-b7dfd2dc2824"
level: "task"
title: "Layer 6 · Outliers: benchmark to bench config, shorter sleeps, two unexplained waits"
status: "pending"
priority: "low"
source: "ndx-capture"
acceptanceCriteria:
  - "write-path-profile no longer runs under pnpm test"
  - "No single rex or root file exceeds 20s on the Windows leg other than the e2e CLI files"
description: "Move write-path-profile.test.ts under vitest.bench.config.ts keeping a thin unit test for the bound. Shorten the sleeps in add-stdin-hang.test.ts. Profile migrate-layout.test.js (27x slower on Windows) and export-lock.test.ts on Windows and fix what they wait on. Update tests/wall-clock-assertion-inventory.md if any timing assertion moved."
lastModified: "2026-10-12T14:52:26.158Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
