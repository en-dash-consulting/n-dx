---
id: "019399a6-ea02-4193-be85-9a411a30dc55"
type: "task"
title: "The area read reports a tied Inbox guess as its top candidate's strength, not \"tied\""
slug: "the-area-read-reports-a-tied-inbox"
description: "Severity low; verdict out-of-scope for task 79842c6f (introduced by the area-read task 056a30fd in this change).\n\nScenario: an Inbox change whose placement shortlist has its top two candidates at the same score, with the top one in this area. The Inbox page shows its guess as \"tied\" (bestGuess in views/inbox.ts uses placement.tied). buildAreaDetail (packages/web/src/server/routes-rex/product.ts ~609) sends only top.strength, so the area's Waiting in the Inbox card shows \"strong\" or \"possible\" for the same change. The two views disagree, and the area card overstates rex's confidence.\n\nReachable: any area view whose area holds a tied top guess.\n\nOptions: (a) recommended: add `tied` to AreaInboxGuess (or send strength \"tied\") from suggestion.tied, and render it with StrengthChip as the Inbox page does. Cheap, one field. (b) Leave it and document that the area card shows the top candidate's strength only."
acceptanceCriteria:
  - "When an Inbox change's top two placement candidates tie, the area read marks its guess as tied"
  - "The area's Waiting in the Inbox card shows the 'tied' strength chip for that change"
  - "A server unit test covers a tied shortlist in the area read"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
