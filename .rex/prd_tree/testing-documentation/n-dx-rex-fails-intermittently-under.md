---
id: "d3a995ca-7ea2-400a-b9a3-37f07acaa77f"
level: "task"
title: "`@n-dx/rex` fails intermittently under `pnpm test` but passes standalone"
status: "in_progress"
priority: "medium"
tags:
  - "flaky-test"
  - "ci-reliability"
source: "ndx-capture"
startedAt: "2026-09-10T20:40:54.864Z"
acceptanceCriteria:
  - "The failing test and its assertion are captured from a real failing run, not inferred"
  - "The root cause is identified — shared temp path, port/lock collision, timeout under load, or ambient state from another suite"
  - "`pnpm test` passes across at least 20 consecutive runs after the fix"
  - "If the cause is contention rather than a test defect, the fix isolates the resource (unique temp dirs, ephemeral ports) rather than raising a timeout to paper over it"
  - "Any timeout raised is justified in a comment naming what it is waiting for"
description: "Observed three times on 2026-09-10 while validating unrelated work on feat/portable-prd-bundle. `pnpm test` reports `FAIL @n-dx/rex` and exits non-zero; `pnpm --filter @n-dx/rex test` immediately afterwards passes in full (238 files, ~5023 tests), and a repeat `pnpm test` also passes. No code change was involved — the same commit both failed and passed.\n\nWhat is known:\n- Only `@n-dx/rex` has been seen to fail this way; the other five suites passed every time.\n- It reproduces only under the recursive run, where `pnpm -r` executes package suites in parallel, not under a single-package run.\n- Two attempts to capture the failing test name produced clean runs, so the failing assertion has never been seen. The summary line names the suite; the per-test output was already scrolled past or absent by the time it was inspected.\n\nLikely shapes, none confirmed: contention for a shared temp path or fixture directory between rex's own parallel workers and another package's; a port or lock collision; a timeout that only trips when five other suites are competing for CPU (rex is the largest suite and several of its tests spawn the CLI as a subprocess with `DEFAULT_TIMEOUT` guardrails); or a test that depends on ambient state another package's suite mutates.\n\nWhy it matters beyond noise: an intermittently red `pnpm test` trains everyone to re-run rather than read, which is how a real regression gets waved through. It also makes any single green run weaker evidence than it appears.\n\nFirst step is capture, not fix: run `pnpm test` in a loop with per-package output tee'd to files (`pnpm test 2>&1 | tee run-$i.log`) until one fails, then read the rex block for the failing test and its assertion. Only then is there something to diagnose. `--reporter=verbose` or `--no-file-parallelism` on the rex suite may make the difference observable."
lastModified: "2026-09-10T20:40:54.870Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
