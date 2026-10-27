---
id: "b0bef249-33ca-4749-87ce-411e528f6dd8"
type: "change"
title: "Merge queue for main (#638)"
slug: "merge-queue-for-main-638"
intent: "Since #626, main's ruleset requires four checks (Build & Validate, CLI Smoke (macOS), CLI Smoke (Windows), CLI Smoke Parity) with strict up-to-date branches and dismisses stale approvals on push, so every merge sends each other open PR through Update branch, a fresh ~27-minute CI run and possibly a re-approval. A GitHub merge queue tests main + the queued PR (or a batch) on a temporary gh-readonly-queue/main/* branch and merges in order with a merge commit. The workflows must answer merge_group before the queue can be enabled in the ruleset; that ruleset change is done by hand in the GitHub UI after this feature's PR lands. Issue #638."
priority: "high"
source: "ndx-capture"
---

Migration suggestion (text claude-opus-5-5, not accepted): place on "PR Build Pipeline and Cross-Platform CLI Validation" (08464700-9955-4338-87b6-afea0646a6f8).
