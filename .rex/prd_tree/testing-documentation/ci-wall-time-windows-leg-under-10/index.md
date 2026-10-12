---
id: "4d39b5b0-fd9d-45ad-a510-30551d185556"
level: "feature"
title: "CI wall time: Windows leg under 10 minutes without dropping coverage"
status: "pending"
priority: "high"
source: "ndx-capture"
acceptanceCriteria:
  - "Windows test wall time is under 15 minutes after the workflow-only layer and under 10 minutes after the fold layer"
  - "No test is skipped or removed to get there; test counts per file do not drop"
  - "Every layer's PR description records per-suite seconds from its CI run"
description: "The Windows CI leg runs 29.4 of its 30 allowed minutes; macOS and Linux spend 11 to 19. Setup and build are under two minutes on every leg, so the whole cost is the two test steps. Root cause review (run 38193308009): suites run strictly in series with 2.4 to 2.9 effective workers of 4; three e2e files (cli-ci, cli-init, cli-prd-bundle) form each suite's tail at 171 to 255s on Windows; git and CLI spawns run 13x to 17x slower on Windows with no Defender exclusion; web spends 65% of its wall time on per-file environment and import. Delivered as a stacked PR series, one task per layer, each PR recording the measured per-suite seconds from its own CI run."
lastModified: "2026-10-12T14:50:49.490Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Layer 1 · Workflow only: parallel test jobs per OS, Defender exclusion, Node compile cache](./layer-1-workflow-only-parallel-test.md) | pending |
| [Layer 2 · Quiet green runs: silent passed-only, hench output quiet under vitest, fixture warning](./layer-2-quiet-green-runs-silent-passed.md) | pending |
| [Layer 3 · One global git config for every fixture repo](./layer-3-one-global-git-config-for.md) | pending |
| [Layer 4 · Isolation off for unit projects, one package at a time](./layer-4-isolation-off-for-unit.md) | pending |
| [Layer 5 · Fold spawn-per-test e2e files into run-once, assert-many](./layer-5-fold-spawn-per-test-e2e-files.md) | pending |
| [Layer 6 · Outliers: benchmark to bench config, shorter sleeps, two unexplained waits](./layer-6-outliers-benchmark-to-bench.md) | pending |
| [Layer 7 · Optional: one vitest invocation across the monorepo via test.projects](./layer-7-optional-one-vitest-invocation.md) | pending |
