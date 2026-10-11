---
id: "f60294c0-b514-4a46-baed-b9f6b517cd98"
level: "feature"
title: "Robot Wrangler stack 3/9 · Review settings and a safe cross-vendor reviewer path"
status: "pending"
priority: "medium"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-3"
source: "claude-code: Robot Wrangler redesign session 2026-10-10 (PR stack)"
acceptanceCriteria:
  - "`hench.review.mode`, `hench.review.vendor` and `hench.review.rounds` are validated settings that `ndx work --resolve` reports with their sources."
  - "Closes #656 and #468."
description: "Robot Wrangler is gaining a Review section with three modes: Off; Self review (today's `ndx work --review`, where the executor re-reads its own work on a stronger model and fixes what it finds); and Pair review, where a different vendor reviews and the executor fixes the must-fix findings. This PR adds the project-level settings those modes need, and closes two open problems on the existing cross-vendor reviewer path (`ndx pair-programming`) before more traffic goes through it.\n\nThis is PR 3 of the 9-PR Robot Wrangler stack. Pair review itself lands in PRs 7 and 8; until then `pair` is a recognised value that runs no review and says so.\n\nGoal: Review mode, reviewer vendor and fix rounds are real settings, and the reviewer path respects repository trust."
lastModified: "2026-10-10T23:40:09.214Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Add hench.review.mode, hench.review.vendor and hench.review.rounds as project settings for the review pass](./add-hench-review-mode-hench-review.md) | completed |
| [Apply repository trust to guard.env and read cli_path from .n-dx.local.json on the cross-vendor reviewer path](./apply-repository-trust-to-guard-env.md) | pending |
