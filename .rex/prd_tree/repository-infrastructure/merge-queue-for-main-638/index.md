---
id: "b0bef249-33ca-4749-87ce-411e528f6dd8"
level: "feature"
title: "Merge queue for main (#638)"
status: "pending"
priority: "high"
source: "ndx-capture"
acceptanceCriteria: []
description: "Since #626, main's ruleset requires four checks (Build & Validate, CLI Smoke (macOS), CLI Smoke (Windows), CLI Smoke Parity) with strict up-to-date branches and dismisses stale approvals on push, so every merge sends each other open PR through Update branch, a fresh ~27-minute CI run and possibly a re-approval. A GitHub merge queue tests main + the queued PR (or a batch) on a temporary gh-readonly-queue/main/* branch and merges in order with a merge commit. The workflows must answer merge_group before the queue can be enabled in the ruleset; that ruleset change is done by hand in the GitHub UI after this feature's PR lands. Issue #638."
lastModified: "2026-10-09T16:47:16.994Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Document landing through the queue](./document-landing-through-the-queue.md) | completed |
| [PR template and its test still say GitHub squash-merges PRs](./pr-template-and-its-test-still-say.md) | pending |
| [Workflows answer merge_group events](./workflows-answer-merge-group-events.md) | completed |
