---
id: "dd9c5ff1-38fe-4dea-8b31-ebc9271f8a37"
type: "change"
title: "Stack review fixes: hardening (PR 20)"
slug: "stack-review-fixes-hardening-pr-20"
intent: "Hardening fixes from the 2026-10-16 stack review: regex and expansion costs on repository content, sv pack install safety, grammar toolchain verification, a CI guard for the grammar steps, and release-scope checks. Stacked on #824 (PR 19). Brief: workshop language-scaling/pr17-20-review-fixes-brief.md."
acceptanceCriteria:
  - "No build-file reader has super-linear cost on repository content; pathological inputs are bounded by tests"
  - "sv pack runs npm without lifecycle scripts, locks the pack directory, and verifies offline bundles"
  - "Every grammar toolchain download is pinned and verified"
  - "A test fails when CI's grammar steps stop reaching a suite that needs grammars"
touches:
  - "6119e976-db18-4bb7-a1e1-ae6e40b7d197"
priority: "high"
tags:
  - "language-packs"
  - "review-fixes"
  - "security"
  - "hardening"
  - "pr-20"
source: "review"
blockedBy:
  - "64050aaf-66fa-411c-90cb-7e89b93c0654"
---
