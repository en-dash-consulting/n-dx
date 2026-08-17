---
id: "676af18f-c764-45e3-812c-6755fa0004c7"
level: "task"
title: "Stabilize rex's load-sensitive performance assertions"
status: "pending"
priority: "high"
tags:
  - "testing"
  - "flakiness"
  - "performance"
  - "rex"
  - "ci"
source: "exploration-2026-08-17"
acceptanceCriteria:
  - "The four named files pass as part of a full concurrent `pnpm test` run, repeatedly (at least 3 consecutive runs)"
  - "Each of the four is explicitly classified as regression gate or benchmark, with the reasoning recorded"
  - "Any assertion kept as a gate no longer depends on absolute wall-clock on an unloaded machine"
  - "Anything reclassified as a benchmark is removed from the pass/fail suite and still runnable on demand"
  - "The lock-serialization test's fix addresses concurrency semantics, not just a longer timeout"
  - "No performance budget was simply raised to make a red go away without deciding what it is measuring"
description: "Four rex test files fail under full-suite load and pass in isolation:\n\n  tests/unit/store/folder-tree-parser.test.ts   \"parses a 200-item tree in under 500 ms\"  — measured 991ms, and 6162ms on a heavier run\n  tests/integration/add-auto-reshape.test.ts    \"scoped pass completes within 500ms on a 100-item sibling subtree\" — measured 30032ms\n  tests/integration/prd-tree-atomic-writes.test.ts  \"second writer waits for first writer to release lock\"\n  tests/integration/profile-prd-tree-write.test.ts  \"Profile: PRD folder-tree write path\"\n\nIn isolation all four pass (76 passed, 3 skipped). The trigger is concurrency: `pnpm test` runs the root suite and then `pnpm -r run test`, which executes packages CONCURRENTLY — rex's 4448 tests compete with sourcevision's 1691 and llm-client's 1213, plus whatever the root e2e suite left behind. A 500ms wall-clock budget measured at 30s is not measuring the code.\n\nThese are pre-existing and unrelated to the spawn-hardening work; they were observed repeatedly across runs on 2026-08-17. They matter more now for two reasons: the sibling CI-matrix task will run this suite on Windows and macOS runners, which are slower and noisier than the current ubuntu-only job; and every spurious red trains people to ignore the suite.\n\nPick per-test, do not blanket-raise budgets:\n- For the two parse/reshape budgets, decide whether the intent is a REGRESSION GATE or a BENCHMARK. If a gate, measure work rather than wall-clock (operation counts, complexity) or calibrate against a same-run baseline so the threshold scales with machine speed. If a benchmark, move it out of the pass/fail suite (e.g. a `pnpm bench` target) rather than leaving a load-dependent assertion in CI.\n- profile-prd-tree-write is a profiler by name; it very likely belongs in the benchmark category.\n- The lock-serialization test is a genuine concurrency assertion, not a speed one — investigate separately. It may need a longer acquire window or event-based waiting rather than a timing assumption.\n\nAlso worth evaluating: whether `pnpm -r run test` should be serialized (`--workspace-concurrency=1`) for the timing-sensitive packages. That is a cheaper global fix but costs wall-clock on every run, so weigh it against per-test changes."
---
