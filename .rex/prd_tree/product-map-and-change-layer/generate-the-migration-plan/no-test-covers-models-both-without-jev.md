---
id: "ec252f43-a666-4825-bea9-1ad13ea88b7d"
level: "task"
title: "No test covers models both without Jev, so a change that always parks the text answer would leave every held change unsettled"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A test plans with models both, a mocked text seam and no Jev, and asserts the held change is placed by the text pass with used \"text\" and no parkedTextPlacement"
  - "That test fails if the context.seams?.jev condition is removed from placementTextPass.merge"
description: "Verdict: should-fix (low). This is a test gap; the code is correct today.\n\nScenario: `placementTextPass.merge` (packages/rex/src/migrations/v1-to-v2/placement-pass.ts) parks the text answer only when `settings.models === \"both\" && context.seams?.jev`. With `both` and no TypeSafe key, `placementSeams` gives no jev seam, so the text pass must decide. If someone dropped the `context.seams?.jev` check, every held change would keep `parkedTextPlacement` and stay held, and placement-pass.test.ts would still pass: it covers `both` only with a judge present.\n\nThis is the common path for a user who configures `both` without a key. Introduced by 0734e6b6.\n\nFix: one test that plans with `{ models: \"both\", autoAccept: \"agree\" }`, a text seam and `jevAvailable: false`. It expects the change placed by the text pass, `used: \"text\"`, no `parkedTextPlacement`, and the Jev-unavailable warning. Cost: about 10 lines."
lastModified: "2026-10-08T23:45:34.513Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
