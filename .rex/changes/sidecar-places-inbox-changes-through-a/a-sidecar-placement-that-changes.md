---
id: "8ca54c75-dc5d-4a34-88da-c13b51ffc90c"
type: "task"
title: "A Sidecar placement that changes nothing logs the change's previous editor as approvedBy"
slug: "a-sidecar-placement-that-changes"
description: "Verdict: should-fix (adversarial review of dc9f6945, run 7057f787).\n\nThe failure: sidecarDecisionFields (packages/web/src/server/routes-rex/rex-route-helpers.ts) gets approvedBy by reading the change's lastModifiedBy after the write. withPrdModelTransaction stamps only nodes whose content changed. rex recordPlacement with relation touches on a change that already touches the target, and is already out of the Inbox, changes nothing. In that case no stamp is written, and approvedBy names whoever last edited the change. That could be a teammate's identity committed from another machine. It can also be absent.\n\nA second window: a writer that lands between the transaction and the read-back gets its own stamp.\n\nHow it is reached: raise place_change_card for touches on a target the change already touches, then approve it.\n\nFix options:\n(a) Pass { now: () => now } to withPrdModelTransaction in writePlacement. Accept lastModifiedBy only when the node's lastModified equals that stamp; otherwise omit approvedBy. This is cheap and needs no gateway change.\n(b) Export rex's resolveActor through the web rex-gateway and use it directly. This is exact, but it raises the gateway export cap, which is a last resort.\n\nRecommendation: (a)."
acceptanceCriteria:
  - "Approving a Sidecar touches placement on a change that already touches the target, and whose lastModifiedBy names another identity, never logs that identity as approvedBy (test in sidecar-place.test.ts)"
  - "A placement that changes the change still logs approvedBy equal to the change's new lastModifiedBy"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
