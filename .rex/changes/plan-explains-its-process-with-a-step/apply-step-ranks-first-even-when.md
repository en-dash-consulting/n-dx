---
id: "9eff53a7-456a-4a8a-b2c2-01a1b3fc7452"
type: "task"
title: "Apply step ranks first even when changes apply at release time"
slug: "apply-step-ranks-first-even-when"
summary: "On projects that apply finished work automatically at release, the planning guide still tells people to apply it by hand and hides the next real step. This makes the guide respect that setting."
description: "Verdict: should-fix (severity medium), from the adversarial review of feat/plan-process-visual.\n\nTrigger: .n-dx.json sets rex.applyOn: 'release' and one change is completed. stageOf puts it in awaiting-apply (server/routes-rex/product.ts:333), so the band says '1 change done: apply it to the product map' and ranks it above Inbox placement until the next release, although rex release applies completed changes itself (rex/src/cli/help.ts:761). Under the default 'complete', awaiting-apply only happens when an apply is refused, so ranking it first is right there. The summary carries no applyOn, so the client cannot tell.\n\nEvidence: packages/web/src/viewer/views/plan-process.ts:60-62.\n\nFix: (a) add applyOn to ChangeSummaryWire and under 'release' drop Apply below Work or say 'waits for the next release' (small server+client change); (b) mode-neutral cue ('done, waiting to be applied'). Recommend (a) if the summary route is touched, else (b)."
acceptanceCriteria:
  - "With applyOn set to release, the band does not tell the user to apply completed changes by hand and does not rank Apply above Inbox placement"
  - "With the default applyOn, a change awaiting apply still ranks first"
  - "Unit tests cover both apply modes"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
