---
id: "dd9c5ff1-38fe-4dea-8b31-ebc9271f8a37"
level: "feature"
title: "Stack review fixes: hardening (PR 20)"
status: "completed"
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
startedAt: "2026-10-17T11:20:54.587Z"
completedAt: "2026-10-17T11:20:54.587Z"
endedAt: "2026-10-17T11:20:54.587Z"
resolutionType: "code-change"
resolutionDetail: "PR 20: linear Python requirement/uv-glob/pom/Maven parsing with revert-proof budget tests, memoised and depth-safe Maven interpolation, Terraform instance-cap test, sv pack --ignore-scripts, pack-dir lock and SHA-256 bundle verification, pinned wasi-sdk/binaryen (digests match GitHub's), CI grammar-step guard covering every pack suite group, release-scope checks. Verified byte-identical against PR 19 with a fresh verified toolchain build."
acceptanceCriteria:
  - "No build-file reader has super-linear cost on repository content; pathological inputs are bounded by tests"
  - "sv pack runs npm without lifecycle scripts, locks the pack directory, and verifies offline bundles"
  - "Every grammar toolchain download is pinned and verified"
  - "A test fails when CI's grammar steps stop reaching a suite that needs grammars"
description: "Hardening fixes from the 2026-10-16 stack review: regex and expansion costs on repository content, sv pack install safety, grammar toolchain verification, a CI guard for the grammar steps, and release-scope checks. Stacked on #824 (PR 19). Brief: workshop language-scaling/pr17-20-review-fixes-brief.md."
lastModified: "2026-10-17T11:20:54.912Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [A deep Maven property chain overflows the call stack and rejects readMavenBuildModels](./a-deep-maven-property-chain-overflows.md) | completed |
| [A failing Maven property chain is re-walked, quadratically, for every reference](./a-failing-maven-property-chain-is-re.md) | completed |
| [A regressed backtracking regex hangs the lang-kit suite instead of failing a named test](./a-regressed-backtracking-regex-hangs.md) | completed |
| [Guard CI's grammar steps with a test and cover every group that runs a pack suite](./guard-ci-s-grammar-steps-with-a-test.md) | completed |
| [Hold every published package to the release group, and list them in OPEN_SOURCE_SCOPE.md](./hold-every-published-package-to-the.md) | completed |
| [Lock the pack directory for sv pack writers](./lock-the-pack-directory-for-sv-pack.md) | completed |
| [Make pom.xml reading linear and bounded](./make-pom-xml-reading-linear-and-bounded.md) | completed |
| [Make uv workspace member globs safe to compile and linear to match](./make-uv-workspace-member-globs-safe-to.md) | completed |
| [Memoise and cap Maven property interpolation](./memoise-and-cap-maven-property.md) | completed |
| [Pin and verify the WASM toolchain the grammar build downloads](./pin-and-verify-the-wasm-toolchain-the.md) | completed |
| [Remove exponential backtracking from Python requirement specifier parsing](./remove-exponential-backtracking-from.md) | completed |
| [Run npm without lifecycle scripts in sv pack](./run-npm-without-lifecycle-scripts-in.md) | completed |
| [Test the Terraform module-instance cap](./test-the-terraform-module-instance-cap.md) | completed |
| [Verify offline pack bundles and limit what they replace](./verify-offline-pack-bundles-and-limit.md) | completed |
