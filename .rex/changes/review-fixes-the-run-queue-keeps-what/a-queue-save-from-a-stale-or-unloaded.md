---
id: "87e443e0-0366-4005-9dfc-4a98397cd364"
type: "task"
title: "A queue save from a stale or unloaded panel overwrites the queue"
slug: "a-queue-save-from-a-stale-or-unloaded"
summary: "Adding a task to the run queue before the queue had loaded, or from a second window, could silently replace or undo the queue someone else had just set."
description: "Failure: the viewer store (views/run-queue.ts) builds every PUT from its own copy (ids()), and the server (routes-hench-queue.ts) replaces the file blindly. (a) Ready to run's \"Add to run queue\" clicked before GET /api/hench/queue answers, or after it failed (items fall back to []), PUTs [that task] and erases the queue. (b) Two tabs, or a tab that has not yet seen ndx work take an item: its PUT restores the taken item or drops the other tab's addition. Reachable: Work › Tune, Work › Now, Plan › Preparation. Verdict: must-fix. Fix (chosen): every PUT carries `base`, the order the client last saw; the server answers 409 with the queue as it stands when the file differs, and the client shows that queue with a note to try again. A failed read leaves the queue unknown, and adding is refused until it loads. Alternative: op-based routes (add/move/remove) — more surface for the same safety."
acceptanceCriteria:
  - "A PUT whose base differs from the saved queue is refused with 409 and the current queue, and writes nothing"
  - "The panel and Ready to run show the queue as it stands after a 409, with a note"
  - "Adding before the queue has loaded never replaces it"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
source: "ndx-adversarial-review"
---
