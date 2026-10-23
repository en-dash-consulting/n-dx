---
id: "661f8e0c-ab58-46b9-98e7-e3340bf7bda8"
type: "change"
title: "Implement cross-vendor validation pass in pair-programming mode"
slug: "implement-cross-vendor-validation-pass"
intent: "The pair-programming mode should add a second-opinion step after the primary vendor completes its work: if the active vendor is Codex, Claude is invoked to run tests and review the output; if the active vendor is Claude, Codex performs the review. The reviewer vendor should run the project test suite (or a scoped subset) and produce a structured pass/fail verdict with any failures surfaced to the terminal. This makes the two vendors act as a bickering pair — one does the work, the other checks it."
acceptanceCriteria:
  - "When vendor is codex, pair-programming mode invokes claude to run the configured test command after the primary work step completes"
  - "When vendor is claude, pair-programming mode invokes codex to run the configured test command after the primary work step completes"
  - "The reviewer vendor output (pass/fail + summary) is printed to the terminal under a clearly labeled 'Reviewer (claude|codex)' section"
  - "If the reviewer detects test failures, the overall command exits non-zero and the failures are printed verbatim"
  - "If the reviewer vendor is unavailable or not authenticated, pair-programming mode falls back gracefully with a warning rather than crashing"
  - "ndx pair-programming --help documents the cross-vendor review behavior and fallback conditions"
  - "Integration test covers both vendor-direction cases (codex-primary/claude-review and claude-primary/codex-review) with a mock test command"
amends: [{"target":"9611c581-175a-4c59-8d3a-e265e8383745","delta":"modified","summary":"Implement cross-vendor validation pass in pair-programming mode","base":"d6cf3731d697af06c800f5d91ea8094ec8e52273f4e209080caa1b7d5f167f39"}]
priority: "high"
tags:
  - "llm"
  - "multi-vendor"
  - "validation"
  - "orchestration"
source: "smart-add"
---
