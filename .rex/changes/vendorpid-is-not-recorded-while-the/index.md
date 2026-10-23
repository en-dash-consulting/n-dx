---
id: "e13d2ffd-bd51-45fc-a0c5-45957d29f48e"
type: "change"
title: "vendorPid is not recorded while the review pass and the warm-parent orientation spawn are running"
slug: "vendorpid-is-not-recorded-while-the"
intent: "Failure: the review spawn (`packages/hench/src/agent/lifecycle/cli-loop.ts:1469`) and the warm-parent orientation spawn (`cli-loop.ts:2234`) do not pass `liveProgress`, so the heartbeat deletes `run.vendorPid` while a vendor CLI is running; the review can run for minutes. The Live task page then cannot tell a slow review from a dead one.\n\nReachability: every --review run. Verdict: should-fix (severity low).\n\nOptions:\n- Recommended: pass `liveProgress` (or a separate pid holder if their counters must stay apart) to both spawns, and add a unit test for the heartbeat's set and delete of vendorPid. Small."
acceptanceCriteria:
  - "During the review pass the run record carries the reviewer CLI's vendorPid, refreshed by the heartbeat (test)."
  - "vendorPid is cleared after the review spawn exits."
touches:
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "live"
source: "ndx-adversarial-review"
---
