---
id: "3e8c3c2a-c3ba-4385-97ae-a6b16cac6208"
type: "change"
title: "Diagnose timer-expiry auto-commit stall path in hench loop and identify blocking call site"
slug: "diagnose-timer-expiry-auto-commit"
intent: "Trace the hench run loop through the 'Auto-commit: committed staged changes (timer expiry)' code path to identify exactly where and why execution stalls in --yes/--loop mode. Determine whether the stall is a missing acknowledgment, an unhandled promise, a state machine gap, or an unexpected prompt waiting for input that --yes never satisfies."
acceptanceCriteria:
  - "Identified the exact file and line where the loop stalls after a timer-expiry auto-commit"
  - "Determined whether the block is a prompt, an awaited event, or a state transition that never fires"
  - "Confirmed the diagnosis is reproducible — either by test or by documented reproduction steps"
  - "No production code changed in this task"
touches:
  - "97d7228b-d4f4-452e-9f5a-dcaeb2d92ae0"
priority: "critical"
tags:
  - "hench"
  - "loop"
  - "auto-commit"
  - "bug"
source: "smart-add"
---
