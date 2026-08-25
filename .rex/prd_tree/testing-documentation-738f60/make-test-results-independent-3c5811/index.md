---
id: "3c581157-d9c7-4c01-9031-b6f27a1acfe0"
level: "feature"
title: "Make test results independent of ambient environment and machine load"
status: "completed"
priority: "high"
tags:
  - "testing"
  - "determinism"
  - "flakiness"
  - "developer-experience"
source: "exploration-2026-08-17"
startedAt: "2026-08-19T18:53:00.342Z"
completedAt: "2026-08-20T13:35:05.327Z"
endedAt: "2026-08-20T13:35:05.327Z"
acceptanceCriteria:
  - "A full local run produces the same verdict regardless of the developer's terminal/color environment"
  - "A full local run produces the same verdict whether packages run concurrently or in isolation"
  - "No test writes into the repository working tree; fixture artifacts land in temp directories"
  - "No test mutates shared worker environment state in a way a sibling test file or spawned child can observe"
  - "Where a timing budget is genuinely load-dependent, it is either made load-robust or explicitly documented as a benchmark that is not a pass/fail gate"
description: "Four verified cases where the suite's result depends on something other than the code under test. Each was hit directly while working the Windows spawn-hardening tasks on 2026-08-17.\n\nThe shared failure mode is that a test's verdict is a function of (code, ambient env, machine load) instead of (code). That is corrosive in a specific way: it teaches people to disbelieve red, and it hides real regressions behind \"probably just flaky.\"\n\nTwo of these are invisible in CI and only ever hurt humans running the suite locally — the FORCE_COLOR sensitivity is silent on GitHub runners because they do not set it, so the first person to hit it sees 24 failures with no hint that their terminal caused them. That is the worst possible distribution: green where nobody is watching, red where someone is trying to onboard.\n\nOne case is masked rather than fixed: the stray `claude.args` file has a `.gitignore` entry (`.gitignore:55`) instead of a corrected write path.\n\nScope note: this is about determinism of the harness, not about adding coverage. No production behavior should change."
---

## Children

| Title | Status |
|-------|--------|
| [Convert write-path-profile's absolute budgets to scaling assertions](./convert-write-path-profile-s-94e034.md) | completed |
| [Fake-CLI fixtures write .args into the repo root instead of a temp dir](./fake-cli-fixtures-write-args-76a37b.md) | completed |
| [Give add-auto-reshape's scaling gate a min-of-N, and fix its shared-tree confound](./give-add-auto-reshape-s-scaling-5980e3.md) | completed |
| [Make the tests' sh-on-PATH dependency explicit instead of failing opaquely](./make-the-tests-sh-on-path-be8e19.md) | completed |
| [Neutralize ambient color env so FORCE_COLOR does not fail 24 tests](./neutralize-ambient-color-env-so-4afde0.md) | completed |
| [packages/hench/tests/unit/tools/git.test.ts spawns `sh` unguarded, so 7 cases fail from PowerShell](./packages-hench-tests-unit-tools-9a38b7.md) | completed |
| [Stabilize rex's load-sensitive performance assertions](./stabilize-rex-s-load-sensitive-676af1.md) | completed |
| [Triage the 39 hench/web failures now that the run no longer hides them](./triage-the-39-hench-web-741bac.md) | completed |
| [vi.stubEnv in child-lifecycle.test.js leaks NDX_DEBUG_LIFECYCLE into sibling e2e children](./vi-stubenv-in-child-lifecycle-afec81.md) | completed |
