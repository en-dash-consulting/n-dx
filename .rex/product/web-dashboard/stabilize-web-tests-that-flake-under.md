---
id: "8230a96e-0108-494d-879b-4a76f7ee4360"
type: "capability"
title: "Stabilize web tests that flake under parallel suite load"
slug: "stabilize-web-tests-that-flake-under"
statement: "The web package's test suite gives the same result whether a test runs alone or under parallel full-suite load, and the web typecheck covers the test files as well as the source."
criteria: [{"id":"c1","text":"The web package's flaky-under-load tests shall not depend on wall-clock timing ratios or on module-level server state shared between tests, or shall run explicitly isolated."},{"id":"c2","text":"The web route tests shall reset shared server state, such as active hench executions, between tests."},{"id":"c3","text":"The DOM performance monitor tests shall check scaling with deterministic counters or instrumentation instead of measured timing ratios."},{"id":"c4","text":"The web package typecheck shall include the files under tests/, so a type error or syntax error in a test fails the typecheck gate."}]
priority: "high"
---

Four distinct web tests have each failed exactly once during full-suite runs while passing consistently in isolation, a different one each run — evidence of machine-load sensitivity rather than regressions. Observed: (1) routes-hench-audit terminate 404 got 200; (2) routes-hench-execute 404 got 401 — both suspected shared module-level state (activeExecutions) or port/env sensitivity; (3) graph-view back/forward vi.waitFor timed out at 3000ms; (4) dom-performance-monitor linear-scaling ratio measured 43x against a 30x ceiling — both wall-clock timing assertions that degrade under vitest worker contention. Diagnose per family and make them deterministic: replace timing-ratio assertions with deterministic counters/instrumentation, reset shared server state between tests, and raise or remove wall-clock thresholds that cannot hold under load.
