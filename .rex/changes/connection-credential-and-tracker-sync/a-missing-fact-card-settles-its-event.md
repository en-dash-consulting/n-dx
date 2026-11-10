---
id: "c771dfe4-f729-4175-a941-e65781443681"
type: "task"
title: "A missing-fact card settles its event, so supplying the fact later never replays the tracker move"
slug: "a-missing-fact-card-settles-its-event"
description: "From the review of 3b86452e (46, workflow facts). When a move lacks a required fact (reviewer, delivery note) the engine records a card and settles the event; adding the fact afterwards (a trackerSync.reviewers entry, a CODEOWNERS line) does not replay it. Options: keep the event pending while its card is open and re-plan on the next tick; or have Approve on the card supply the fact and run the call (45c's card already runs a planned call)."
acceptanceCriteria:
  - "After a missing-fact card, supplying the fact (config or the card's form) makes the next tick or the card's Approve carry out the move once (test)"
priority: "low"
source: "ndx-adversarial-review"
---
