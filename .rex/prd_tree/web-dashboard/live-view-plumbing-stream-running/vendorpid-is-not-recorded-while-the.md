---
id: "e13d2ffd-bd51-45fc-a0c5-45957d29f48e"
level: "task"
title: "vendorPid is not recorded while the review pass and the warm-parent orientation spawn are running"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "live"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "During the review pass the run record carries the reviewer CLI's vendorPid, refreshed by the heartbeat (test)."
  - "vendorPid is cleared after the review spawn exits."
description: "Failure: the review spawn (`packages/hench/src/agent/lifecycle/cli-loop.ts:1469`) and the warm-parent orientation spawn (`cli-loop.ts:2234`) do not pass `liveProgress`, so the heartbeat deletes `run.vendorPid` while a vendor CLI is running; the review can run for minutes. The Live task page then cannot tell a slow review from a dead one.\n\nReachability: every --review run. Verdict: should-fix (severity low).\n\nOptions:\n- Recommended: pass `liveProgress` (or a separate pid holder if their counters must stay apart) to both spawns, and add a unit test for the heartbeat's set and delete of vendorPid. Small."
lastModified: "2026-10-01T15:23:14.635Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
