---
id: "f76d0e7d-ca55-4080-af71-c3c7ff4bae9c"
type: "task"
title: "Plan with Sidecar's typed text waits forever, unsaid, when the open session cannot take the turn"
slug: "plan-with-sidecar-s-typed-text-waits"
description: "Verdict: should-fix (medium). Scenario: the drawer's open session has ended (the operator opened an ended session from the list), or the PATCH re-lensing the open session fails, or the registry reports the plan lens unavailable. The operator clicks \"Plan with Sidecar\". planFirstTurnReady (packages/web/src/viewer/components/plan-with-sidecar.ts) never returns true, so main.ts keeps planText pending until the page changes. Nothing is sent and nothing says why: the typed text silently never reaches the Sidecar. Reachable from the Plan capture bar with web.sidecar on. Options: (a) when the open session has ended, start a new session for the first turn: expose a newSession from useSidecar (small, low risk; recommended); (b) show an error line in the drawer (\"Plan with Sidecar could not start: <reason>\") when the lens is unavailable or the PATCH failed, and drop the pending text (small); (c) a timeout that surfaces the stuck state (crude). Recommend (a) plus (b)."
acceptanceCriteria:
  - "With an ended session open in the drawer, Plan with Sidecar starts a new session on the Plan lens and sends the typed text as its first turn"
  - "When the plan lens is unavailable or the session cannot follow the attachment, the drawer says why and the pending text is not held silently"
  - "A unit test covers each case"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
