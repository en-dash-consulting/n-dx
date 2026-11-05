---
id: "71f1ddd1-75a1-42ea-a260-e159232d1c1a"
type: "task"
title: "A 409 on an edited placement approval leaves Place enabled on the stale dry-run line, so pressing it again repeats the 409"
slug: "a-409-on-an-edited-placement-approval"
description: "should-fix (medium), from the adversarial review of 8397f708.\n\nScenario: the operator edits a placement card, reads \"Applies cleanly … @ spec abcd\", and a teammate rewords the target before Place is pressed. POST …/cards/:id answers 409 (\"Nothing was written: the spec of … changed … Check the placement again before approving.\"). use-sidecar's decide() shows the error, but PlacementBody keeps the old edit.check. The line still says \"Applies cleanly\" and Place stays enabled, so each press repeats the 409. The only way to get a new check is to change a field and change it back.\n\nIn the card-base case (the edit keeps the card's target and relation, and the spec moved since the card was raised), no re-check can succeed. The message's \"Check the placement again\" is then wrong: the operator has to Leave in Inbox and have the agent raise a new card.\n\nEvidence: packages/web/src/server/sidecar/placement-card.ts readPlacementEdit (409 text); packages/web/src/viewer/components/sidecar-cards.ts answer(); packages/web/src/viewer/components/sidecar-placement.ts (PlacementBody re-check effect only on draft change).\n\nReachable: yes, through the drawer's Place button on any edited card whose target is edited concurrently.\n\nOptions:\n(a) On a 409 from an edited approval, re-run checkPlacementRequest for the edit so the line and Place update. This is cheap and recommended.\n(b) Return the server's fresh check in the 409 body and have the viewer replace edit.check with it. This is a small API addition.\nFor the card-base case, word the message to say the card must be raised again."
acceptanceCriteria:
  - "After a 409 on an edited placement approval, the card's dry-run line shows the server's current check, and Place is disabled whenever that check would be refused again (viewer test)"
  - "A 409 for an edit that keeps the card's target and relation after the card's spec moved tells the operator to raise a new card, not to check again (server test)"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
