---
id: "dd9c5ff1-38fe-4dea-8b31-ebc9271f8a37"
level: "feature"
title: "Stack review fixes: hardening (PR 20)"
status: "pending"
priority: "high"
tags:
  - "language-packs"
  - "review-fixes"
  - "security"
  - "hardening"
  - "pr-20"
blockedBy:
  - "64050aaf-66fa-411c-90cb-7e89b93c0654"
source: "review"
acceptanceCriteria:
  - "No build-file reader has super-linear cost on repository content; pathological inputs are bounded by tests"
  - "sv pack runs npm without lifecycle scripts, locks the pack directory, and verifies offline bundles"
  - "Every grammar toolchain download is pinned and verified"
  - "A test fails when CI's grammar steps stop reaching a suite that needs grammars"
description: "Hardening fixes from the 2026-10-16 stack review: regex and expansion costs on repository content, sv pack install safety, grammar toolchain verification, a CI guard for the grammar steps, and release-scope checks. Stacked on #824 (PR 19). Brief: workshop language-scaling/pr17-20-review-fixes-brief.md."
lastModified: "2026-10-17T09:20:07.544Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [A regressed backtracking regex hangs the lang-kit suite instead of failing a named test](./a-regressed-backtracking-regex-hangs.md) | pending |
| [Guard CI's grammar steps with a test and cover every group that runs a pack suite](./guard-ci-s-grammar-steps-with-a-test.md) | pending |
| [Hold every published package to the release group, and list them in OPEN_SOURCE_SCOPE.md](./hold-every-published-package-to-the.md) | pending |
| [Lock the pack directory for sv pack writers](./lock-the-pack-directory-for-sv-pack.md) | pending |
| [Make pom.xml reading linear and bounded](./make-pom-xml-reading-linear-and-bounded.md) | pending |
| [Make uv workspace member globs safe to compile and linear to match](./make-uv-workspace-member-globs-safe-to.md) | in_progress |
| [Memoise and cap Maven property interpolation](./memoise-and-cap-maven-property.md) | pending |
| [Pin and verify the WASM toolchain the grammar build downloads](./pin-and-verify-the-wasm-toolchain-the.md) | pending |
| [Remove exponential backtracking from Python requirement specifier parsing](./remove-exponential-backtracking-from.md) | completed |
| [Run npm without lifecycle scripts in sv pack](./run-npm-without-lifecycle-scripts-in.md) | pending |
| [Test the Terraform module-instance cap](./test-the-terraform-module-instance-cap.md) | pending |
| [Verify offline pack bundles and limit what they replace](./verify-offline-pack-bundles-and-limit.md) | pending |
