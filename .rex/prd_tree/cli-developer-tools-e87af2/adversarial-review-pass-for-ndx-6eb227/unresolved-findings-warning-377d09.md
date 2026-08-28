---
id: "377d09bb-6905-41a7-9b9a-40dfde080e08"
level: "task"
title: "Unresolved-findings warning mislabels non-must-fix failures as unrepaired must-fix"
status: "pending"
priority: "low"
tags:
  - "hench"
  - "review-pass"
  - "ux"
source: "ndx-work-e2e-verification"
acceptanceCriteria:
  - "The warning distinguishes unrepaired must-fix findings from other unresolved actions such as failed captures"
  - "run.review.unresolvedCount semantics are documented or split into distinct counts"
description: "unresolvedFindings (packages/hench/src/agent/analysis/adversarial-review.ts:526) includes any finding with action 'failed' regardless of verdict, and the console warning at cli-loop.ts:1186 reports the whole count as 'must-fix finding(s) were not repaired'. In run 4b4526c5 the single unresolved finding was a low/should-fix whose PRD capture failed, but the console claimed an unrepaired must-fix. Counting failures toward alarm is by design; the label overstates the severity and will erode trust in the warning."
lastModified: "2026-08-28T18:23:49.114Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
