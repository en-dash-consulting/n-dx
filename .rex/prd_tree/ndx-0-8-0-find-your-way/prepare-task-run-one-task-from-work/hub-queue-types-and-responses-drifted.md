---
id: "a3931428-741c-4c2b-b3ba-9a17eda3a368"
level: "task"
title: "Hub queue types and responses drifted from run options, and the unscoped queue exposes other projects' notes"
status: "pending"
priority: "low"
tags:
  - "0.8.0"
  - "task-prep"
  - "ndx-adversarial-review"
  - "severity:low"
  - "hub"
  - "web-viewer"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "The queued 202 echoes the accepted options; HubQueueEntry includes options; GET /api/hub/queue never includes contextNotes text (tests)."
description: "Verdict: should-fix.\n\nScenario: the hub's queued 202 (proxy.ts:497) does not echo accepted options while the server's 202 does; the viewer's HubQueueEntry (viewer/hooks/use-hub-queue.ts:43, documented as mirroring QueueEntry) lacks options; unscoped GET /api/hub/queue returns every project's entries including up to 8 KB of contextNotes each. Fix (recommended): echo options in the queued 202; update HubQueueEntry; strip contextNotes (keep a hasNotes flag) from queue snapshots."
lastModified: "2026-10-02T07:47:55.670Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
