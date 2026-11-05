---
id: "a08b5226-df96-4c01-8a36-90a48a74a294"
type: "task"
title: "Diagnose run names a missing task in the lens menu and classifies runs that recorded no verdict"
slug: "diagnose-run-names-a-missing-task-in"
description: "Follow-up to 2914d715 from its browser check: the lens menu shows Diagnose run as available with no task attached and picking it silently does nothing; runs from a hench without R1 (today's global runner) carry no RunRecord.diagnosis, so the packet only shows a gap naming 'hench runs diagnose <id>', which prints the verdict but never writes it; re-run and --fresh cards drop the failed run's model and review settings."
acceptanceCriteria:
  - "The drawer's lens menu (sidecar-drawer.ts) marks a lens whose registry target is not attached with what it needs (Diagnose run without a task: 'needs a task to diagnose'), the same way it marks an unavailable lens; picking it no longer fails silently (tested in sidecar-drawer.test.ts)"
  - "When the newest run has no recorded diagnosis and has ended, the Diagnose run packet's verdict section comes from 'hench runs diagnose <id> --format=json' spawned through SpawnedReads (as Describe spawns --resolve), with its provenance naming that command; no node:child_process in web and no hench import (tested with a stub)"
  - "If that spawn fails or times out, the verdict section is a gap naming the command, as today; a running run is never classified"
  - "The instructions' re-run and --fresh cards carry the failed run's settings: options.model when the run's modelSource was a flag, and review plus reviewModel when the run has a reviewPlan; the verdict section lists them so the model passes them to start_work (tested)"
  - "The buildDiagnoseRunPacket comment says the gate text is the failure digest's start (or the output tail's end), matching the code and docs/architecture/web-server.md"
source: "ndx-capture"
---
