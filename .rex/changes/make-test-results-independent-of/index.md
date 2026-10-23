---
id: "3c581157-d9c7-4c01-9031-b6f27a1acfe0"
type: "change"
title: "Make test results independent of ambient environment and machine load"
slug: "make-test-results-independent-of"
intent: "Four verified cases where the suite's result depends on something other than the code under test. Each was hit directly while working the Windows spawn-hardening tasks on 2026-08-17.\n\nThe shared failure mode is that a test's verdict is a function of (code, ambient env, machine load) instead of (code). That is corrosive in a specific way: it teaches people to disbelieve red, and it hides real regressions behind \"probably just flaky.\"\n\nTwo of these are invisible in CI and only ever hurt humans running the suite locally — the FORCE_COLOR sensitivity is silent on GitHub runners because they do not set it, so the first person to hit it sees 24 failures with no hint that their terminal caused them. That is the worst possible distribution: green where nobody is watching, red where someone is trying to onboard.\n\nOne case is masked rather than fixed: the stray `claude.args` file has a `.gitignore` entry (`.gitignore:55`) instead of a corrected write path.\n\nScope note: this is about determinism of the harness, not about adding coverage. No production behavior should change."
acceptanceCriteria:
  - "A full local run produces the same verdict regardless of the developer's terminal/color environment"
  - "A full local run produces the same verdict whether packages run concurrently or in isolation"
  - "No test writes into the repository working tree; fixture artifacts land in temp directories"
  - "No test mutates shared worker environment state in a way a sibling test file or spawned child can observe"
  - "Where a timing budget is genuinely load-dependent, it is either made load-robust or explicitly documented as a benchmark that is not a pass/fail gate"
touches:
  - "4d39b5b0-fd9d-45ad-a510-30551d185556"
priority: "high"
tags:
  - "testing"
  - "determinism"
  - "flakiness"
  - "developer-experience"
source: "exploration-2026-08-17"
---
