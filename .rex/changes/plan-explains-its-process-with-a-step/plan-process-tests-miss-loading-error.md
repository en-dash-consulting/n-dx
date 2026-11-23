---
id: "0afd3270-f563-43ef-b270-fdd0e6aaab54"
type: "task"
title: "Plan process tests miss loading, error, null-next and ready-beside-in-progress cases"
slug: "plan-process-tests-miss-loading-error"
summary: "The planning guide's tests skip several states, so a regression in them would go unnoticed. This adds the missing cases."
description: "Verdict: should-fix (severity low, alongside the Ready-step fix), from the adversarial review of feat/plan-process-visual.\n\nGaps in packages/web/tests/unit/viewer/plan-process.test.ts: no loading or error render; no Work with next = null; no ready > 0 beside In progress (both map to 'work', so a reordering only changes the cue text and goes unnoticed); the cue tests pin the wording the Ready-step task shows to be wrong and must be updated with it."
acceptanceCriteria:
  - "Tests cover the loading and error renders of the process band"
  - "A test covers the Work step when next is null"
  - "A test covers ready > 0 alongside in-progress work and asserts the cue text"
  - "Cue tests assert the corrected Ready wording"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
