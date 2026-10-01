---
id: "cdf48383-1831-48f3-8305-dc46e55f6522"
level: "task"
title: "A stale analyze progress file whose pid was reused shows a phantom running analysis, and Stop signals the unrelated process"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "live"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "Stop on /live/analyze refuses to signal a pid whose command line is not an analyze process, and says why (unit test with an injected process inspector)."
  - "A progress file marked running whose recorded pid belongs to another program is reported as interrupted, not running (unit test)."
  - "Changeset for @n-dx/sourcevision and @n-dx/web (patch)."
description: "Failure: if an analyze is SIGKILLed (OOM, kill -9, laptop crash), `.sourcevision/.cache/analyze-progress.json` still says `running` with pid X. When the OS later reuses pid X for another process, `defaultIsPidAlive` (`packages/sourcevision/src/analyzers/analyze-progress.ts:389-392`, which also treats EPERM as alive) returns true, so the Live page, overview and running-now bar show a running analysis until the next analyze, and its Stop button calls `signalRecordedPid(X)` (`packages/web/src/server/routes-live-analyze.ts:371-383, 403-412`), sending SIGTERM to the unrelated process. A pid written inside a devcontainer and read on the host behaves the same way. The only guard is `pid === process.pid`; there is no start-time, command-line or freshness check.\n\nReachability: rare (hard kill plus pid reuse), but the consequence is a signal to an arbitrary user process. Verdict: should-fix (severity medium).\n\nOptions:\n- (a) Before signalling, confirm on POSIX that the process command line contains the analyze command (`ps -o command= -p <pid>`); refuse otherwise. Cheap, low risk.\n- (b) Write a progress heartbeat every ~15 s (unref'd timer) and treat `running` with an `updatedAt` older than ~2 minutes as interrupted. Also fixes the phantom display. Medium.\nRecommended: (a) now, (b) as a follow-up."
lastModified: "2026-10-01T15:22:03.480Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
