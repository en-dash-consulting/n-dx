---
id: "bb5f0641-67a7-43d2-b0fe-186faf73c0bc"
type: "change"
title: "Update cli-brand.test.js snapshot to match redesigned ndx init dinosaur"
slug: "update-cli-brand-test-js-snapshot-to"
intent: "The ndx init dinosaur ASCII art was redesigned and corrected in a prior sprint (proportions fixed, animation frames sourced from Rex-F.png). The E2E brand test at tests/e2e/cli-brand.test.js still asserts against the old dinosaur output, causing it to fail or carry a stale snapshot. Update the expected output in the test to match the current canonical dinosaur so the suite is green and serves as an accurate regression guard going forward."
acceptanceCriteria:
  - "tests/e2e/cli-brand.test.js passes cleanly with no snapshot mismatches after the update"
  - "Expected dinosaur output in the test matches the current ndx init dinosaur character-for-character, including whitespace and line boundaries"
  - "No other assertions in cli-brand.test.js are weakened or removed — only stale snapshot strings are replaced"
  - "Full test suite (pnpm test) exits 0 with cli-brand included"
  - "Running ndx init when already initialized (no-change path) displays the same dinosaur as a fresh ndx init run"
  - "The rendered dinosaur matches exactly the canonical art exported from cli-brand.js"
  - "No regression in the standard (first-time) init dinosaur display"
  - "No duplicate dinosaur string literals remain outside cli-brand.js"
  - "cli-brand.test.js snapshots reflect the canonical dinosaur for both standard and no-change init code paths"
  - "All init regression and visual snapshot tests pass without manual override or skip flags"
  - "No snapshot mismatch between no-change and standard init test outputs"
  - "Test suite produces zero snapshot update warnings after the fix is applied"
touches:
  - "6ba40421-b660-40fb-9c7d-70651bb863e1"
priority: "high"
tags:
  - "testing"
  - "cli"
  - "branding"
  - "init"
source: "smart-add"
---
