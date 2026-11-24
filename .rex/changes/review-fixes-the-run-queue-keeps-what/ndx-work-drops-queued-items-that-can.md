---
id: "288fa978-d96a-419e-bd44-aa58cbc24ff6"
type: "task"
title: "ndx work drops queued items that can still run, and a PRD read error empties the queue"
slug: "ndx-work-drops-queued-items-that-can"
summary: "The agent took tasks off the planned queue whenever it could not run them right now, even when they would be runnable later, and a momentary failure to read the plan could empty the whole queue."
description: "Failure: run.ts:1567 tries each queued id with selectTaskEntry((await store.loadDocument()).items, …); takeFromRunQueue (queue/run-queue.ts:97) treats every throw except TaskClaimedElsewhereError as final and removes the item. (a) An item with an open blocker or still in the Inbox throws a CLIError and is dropped, though it becomes runnable later. (b) loadDocument throwing mid-write (another writer, a parse error) throws for every item, so the whole queue is removed. It also reloads the PRD once per queued item. Reachable: plain `ndx work` with a non-empty queue. Verdict: must-fix. Fix (chosen): load the document once before trying the queue so a read failure propagates and leaves the queue alone; drop only on final refusals (TaskNotActionableError: finished/cancelled/deferred, or the task no longer existing); keep blocked, Inbox and claimed-elsewhere items. Alternative: a typed final/passing classification inside brief.ts — more invasive."
acceptanceCriteria:
  - "A blocked queued item is passed over and stays on the queue"
  - "A PRD read failure before selection leaves the queue file unchanged"
  - "A finished or missing queued item is still dropped"
  - "The PRD is read once per selection, not once per queued item"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
source: "ndx-adversarial-review"
---
