---
id: "8230a96e-0108-494d-879b-4a76f7ee4360"
level: "feature"
title: "Stabilize web tests that flake under parallel suite load"
status: "completed"
priority: "high"
startedAt: "2026-08-13T14:43:40.395Z"
completedAt: "2026-08-14T16:15:04.012Z"
endedAt: "2026-08-14T16:15:04.012Z"
acceptanceCriteria:
  - "Ten consecutive full-suite runs pass with no rotating failures"
  - "Each identified flaky test is made deterministic (no timing ratios or shared module state) or explicitly isolated"
  - "Root cause documented per test family: shared server state vs wall-clock timing sensitivity"
description: "Four distinct web tests have each failed exactly once during full-suite runs while passing consistently in isolation, a different one each run — evidence of machine-load sensitivity rather than regressions. Observed: (1) routes-hench-audit terminate 404 got 200; (2) routes-hench-execute 404 got 401 — both suspected shared module-level state (activeExecutions) or port/env sensitivity; (3) graph-view back/forward vi.waitFor timed out at 3000ms; (4) dom-performance-monitor linear-scaling ratio measured 43x against a 30x ceiling — both wall-clock timing assertions that degrade under vitest worker contention. Diagnose per family and make them deterministic: replace timing-ratio assertions with deterministic counters/instrumentation, reset shared server state between tests, and raise or remove wall-clock thresholds that cannot hold under load."
---

## Children

| Title | Status |
|-------|--------|
| [Typecheck test files in the web package](./typecheck-test-files-in-the-web-package.md) | completed |
