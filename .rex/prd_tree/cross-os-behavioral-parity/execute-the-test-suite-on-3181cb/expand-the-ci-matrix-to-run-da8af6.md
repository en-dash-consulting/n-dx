---
id: "da8af67a-a7de-4c87-9308-6ceacb637298"
level: "task"
title: "Expand the CI matrix to run unit/integration/e2e suites on windows-latest and macos-latest"
status: "pending"
priority: "high"
tags:
  - "cross-os"
  - "ci"
  - "testing"
  - "windows"
  - "macos"
source: "exploration-2026-08-17"
acceptanceCriteria:
  - "`pnpm -r run test` and the root vitest suite execute on windows-latest and macos-latest in CI"
  - "A local full-suite run on Windows and macOS was completed first and its failure inventory recorded"
  - "Known-red cases are quarantined with explicit tracking rather than skipped or deleted"
  - "If the matrix is scoped rather than full, the excluded suites and the reason are documented in the workflow file"
  - "smoke-parity artifact collection and diffing still work unchanged"
  - "CI wall-clock and billed-minute delta is measured and reported in the PR body"
description: "Add the two test steps that today exist only in the ubuntu `validate` job to the `smoke-macos` and `smoke-windows` jobs (or restructure into a matrix strategy over [ubuntu, windows, macos]):\n\n  - run: pnpm -r run test\n  - run: node scripts/run-vitest-bind-aware.mjs root\n\nBoth jobs already do checkout → pnpm → setup-node → install → build, so the incremental change is small. Keep `smoke-parity` intact — artifact collection and cross-OS output diffing remain valuable independent of test execution.\n\nSEQUENCING: land this AFTER (or together with) the Windows-skipped-test triage, or expect a long red period. The known-red set today is at least: 6 process-cleanup cases (see the un-skip task under Windows CLI Spawn Hardening) and 4 config/permission cases, plus an unknown number of tests that have simply never run on Windows and may fail on path separators, line endings, or timing. Do a local Windows and macOS full-suite run FIRST to size the actual damage before wiring CI — that measurement is part of this task, not a precondition for it.\n\nPRACTICAL CONSTRAINTS to weigh and report rather than assume away: Windows runners are billed at 2x and macOS at 10x Linux minutes on GitHub-hosted plans, and the root e2e suites spawn real CLI processes, so wall-clock will be materially worse than ubuntu's. If the full suite is impractical, scope the matrix to the OS-sensitive subset (spawn/quoting/lifecycle/config/init suites) and say explicitly in the workflow comments which suites are Linux-only and why — a scoped matrix that runs is worth more than a complete one that gets disabled. Also note `run-vitest-bind-aware.mjs` already handles loopback-bind unavailability, which may behave differently on Windows runners; verify rather than assume.\n\nReport the wall-clock and minute-cost delta in the PR body so the tradeoff is visible to whoever maintains CI."
---
