---
id: "143469bb-be4e-44dc-8682-9c732c1d3771"
type: "change"
title: "Pin the review-dedupe wiring to changes/ on a v2 tree"
slug: "pin-the-review-dedupe-wiring-to"
intent: "Review 2026-10-12, PR #692 should-fix 3 (PLAUSIBLE: read, the revert was not run).\n\nDefect: reviewDedupeDir is unit-tested (packages/hench/tests/unit/agent/lifecycle/uncommitted-work-gate.test.ts:271), but nothing checks that the review brief built on a v2 tree names changes/. The wiring is packages/hench/src/agent/lifecycle/cli-loop.ts:1458.\n\nFailure scenario: revert cli-loop.ts:1458 to `${…}/${PRD_TREE_DIRNAME}/`. Every test stays green, and on v2 the reviewer lists a prd_tree/ that does not exist, so it never finds the existing item and files a duplicate Inbox change.\n\nFix: a test that asserts buildReviewBrief output (or the cli-loop review context) on a v2 fixture names the changes/ directory and not prd_tree/, and fails when the call at cli-loop.ts:1458 is reverted. Confirm the failure by reverting the line locally while writing the test; do not commit the revert."
acceptanceCriteria:
  - "A test builds the review brief (or cli-loop review context) on a v2 fixture and asserts it names changes/ and not prd_tree/; it fails when cli-loop.ts:1458 is reverted to PRD_TREE_DIRNAME"
  - "The v1 review brief is unchanged"
touches:
  - "be394022-52c9-4317-ab29-8bfa26523593"
priority: "medium"
tags:
  - "pr-35"
  - "review-2026-10-12"
  - "lane-hench"
source: "review-2026-10-12"
---
