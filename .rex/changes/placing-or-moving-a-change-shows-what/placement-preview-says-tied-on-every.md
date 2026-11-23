---
id: "c6d9ab2a-67fa-49bf-9172-18e43957d4d4"
type: "task"
title: "Placement preview says 'tied' on every shortlist row, not just the tied ones"
slug: "placement-preview-says-tied-on-every"
summary: "The placement preview tells people a suggestion is tied with another even when it isn't. This only says so for the suggestions that actually tie."
description: "Verdict: should-fix (severity low, one line), from the adversarial review of feat/placement-visuals.\n\nchange-placement.ts:561 sets tied: !!placement?.tied && onShortlist; placement.tied is true when the top two share a score. Trigger: shortlist [A:10, B:10, C:3], pick C → preview says 'Tied with another match: their order means nothing', which is false for C (placement-preview.ts:111).\n\nFix: set tied only when placement.tied holds and the chosen row's score equals shortlist[0].score. Add a third-row test."
acceptanceCriteria:
  - "The tied note shows only for shortlist rows whose score equals the top score when the shortlist is tied"
  - "A test picks a lower-scored row from a tied shortlist and asserts no tied note"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
