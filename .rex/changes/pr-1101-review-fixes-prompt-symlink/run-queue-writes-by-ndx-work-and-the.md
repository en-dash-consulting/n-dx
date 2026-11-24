---
id: "644b513a-6008-4f31-aebc-fc9420fab6f7"
type: "task"
title: "Run queue writes by ndx work and the dashboard can lose each other's updates"
slug: "run-queue-writes-by-ndx-work-and-the"
summary: "When the agent and the dashboard changed the run queue at the same moment, one change could silently undo the other; both now take a shared lock."
description: "Review 4672392642 (P2): hench's removeFromRunQueue and the web PUT each read-modify-write run-queue.json without a lock shared between processes; interleavings drop a dashboard addition or restore an item hench removed. Fix: one lock file beside the queue (run-queue.json.lock, exclusive create with stale-lock recovery) held around the whole read/check/write in both hench and the web route; the lock path and protocol are part of the file contract."
acceptanceCriteria:
  - "hench's removal and the web route's save each hold the shared lock across read, check and write"
  - "A test interleaves a save with a removal and loses neither"
  - "A stale lock left by a dead process does not block forever"
priority: "high"
source: "pr-review"
---
