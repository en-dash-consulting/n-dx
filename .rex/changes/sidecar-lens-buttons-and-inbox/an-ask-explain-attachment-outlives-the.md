---
id: "6ee786f8-f957-437f-95b0-51d3cc14d95e"
type: "task"
title: "An Ask/Explain attachment outlives the item it was asked from when the view stays the same"
slug: "an-ask-explain-attachment-outlives-the"
description: "Scenario: with web.sidecar on, click \"Ask Sidecar\" on task T1 in the PRD view, then open task T2 in the same view (or move between capabilities or zones without leaving the view). main.ts clears askItem only when pageView changes, and pageItemFor ranks `ask` above taskId, capabilityId and zone. The drawer therefore stays attached to T1 while the page shows T2, and T2's button reads as not pressed. Evidence: packages/web/src/viewer/main.ts (setAskItem(null) only in the [pageView] effect); packages/web/src/viewer/hooks/use-sidecar-attachment.ts (the `page.ask` branch comes before the taskId, zone and capability branches). Reachable from any task, capability or zone page. The chip names T1, so this is a confusing result, not a silent wrong one. Describe in Sidecar already behaves the same way (\"dropped with the page\"). Verdict: should-fix (low). Options: (a) drop askItem when openTask, openCapability or page.zone changes to a different ref. This is cheap and recommended, and it matches what the page shows. (b) Keep it sticky but show the stale item in the drawer. That costs more and has no clear benefit. Found by the adversarial review of task a19056bd."
acceptanceCriteria:
  - "After Ask Sidecar on task T1, opening task T2 in the same view attaches T2 (its kind's default lens), not T1 (viewer test)"
  - "After Explain in Sidecar on capability or zone A, opening B in the same view attaches B (viewer test)"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
