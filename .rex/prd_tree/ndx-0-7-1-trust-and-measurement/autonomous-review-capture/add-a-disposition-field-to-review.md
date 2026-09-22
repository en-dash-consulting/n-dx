---
id: "c4c54811-35f7-4015-9729-6ce876384501"
level: "task"
title: "Add a disposition field to review records"
status: "pending"
priority: "medium"
tags:
  - "0.7.1"
  - "autonomous-review-capture"
  - "wm-2088"
  - "pr-l"
source: "caos work management: WM2088 (Add a disposition field to review records); follow-up from the guards run 2026-09-22, PR group L"
acceptanceCriteria:
  - "Every finding written by a review carries disposition ∈ {fixed, dropped, offered, deferred} and an optional reason."
  - "Records written before this change still load (test with an old fixture)."
  - "The review JSON schema and hench show output document the field."
description: ".hench/reviews/<run>.json stores each adversarial-review finding with a severity and text but no record of what happened to it: fixed by the run, dropped at the capture gate, offered and declined, or deferred. Without it nothing downstream can find a dropped finding. Add a disposition field with a small closed set of values and an optional reason, written for every finding at the moment its fate is decided, and keep records without the field loading.\n\nImplementation notes: Extend the review record type (find where .hench/reviews/<run>.json is written under packages/hench/src, likely the adversarial review lifecycle in agent/analysis) with an optional disposition and reason on each finding, set it at every decision point (auto-fixed, captured, declined, deferred), and keep the reader tolerant of its absence. Add unit tests for each disposition and an old-record fixture. Changeset: @n-dx/hench patch. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-22T02:47:36.726Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
