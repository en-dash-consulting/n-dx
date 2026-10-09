---
id: "5bbac2f2-4a34-499e-8a17-4235a1f9c8ae"
level: "task"
title: "A review-sourced epic becomes a standing area with no capabilities"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "An epic whose source is ndx-adversarial-review produces no area entry in the rules-only plan (test)"
  - "Its completed features become fix changes that the placement rules or model passes place on other capabilities (test)"
  - "On this repository's tree, the rules-only plan has no area whose source is ndx-adversarial-review"
description: "Scenario: the v1 epic \"Security & Data Safety\" (9e34fc07, source ndx-adversarial-review) has no release or PR token, so classifyEpic (packages/rex/src/migrations/v1-to-v2/migration-plan.ts, around line 301) makes it an area. Since task 91de46df, classifyUnderArea passes epic.source, so every feature under it becomes a fix change. The rules-only plan on this repository therefore proposes a standing product area that contains only fix changes and no capability. Its title also makes it an all-scope constraint.\n\nReachable: `ndx migrate --plan` on this repository's tree. Verdict: should-fix, low. The plan is reviewable, so this is product-map noise rather than data loss.\n\nOptions:\n(a) Treat a review-sourced epic as a delivery container: hold or place its children the way a dissolved release epic's children are, and propose no area. This is cheap and keeps the product layer clean. Recommended.\n(b) Keep the area and flag it for review in the summary. Cheaper, but the empty area survives into the product layer.\nDecision for Ryan: whether the constraint the epic currently yields (\"Security & Data Safety\" applies to all) should survive as a constraint."
lastModified: "2026-10-09T14:44:24.191Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
