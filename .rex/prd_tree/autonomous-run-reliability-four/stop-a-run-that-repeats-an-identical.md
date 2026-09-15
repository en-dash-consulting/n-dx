---
id: "cbab7b85-7c00-4880-abbb-479bb112ac40"
level: "task"
title: "Stop a run that repeats an identical tool call instead of letting it loop forever"
status: "completed"
priority: "high"
tags:
  - "hench"
  - "gh-362"
source: "GitHub issues #362-#365, filed from the wave-1 session 2026-09-11"
startedAt: "2026-09-11T22:08:49.566Z"
completedAt: "2026-09-11T22:32:11.541Z"
endedAt: "2026-09-11T22:32:11.541Z"
acceptanceCriteria:
  - "A run that repeats an identical failing tool call is stopped with a message naming the repeated call."
  - "A legitimately long task (many distinct tool calls) is not affected."
  - "Blocking on a background task whose process is gone returns an error rather than timing out."
  - "Periodic saves carry turns and token counts, so a running task is not reported as 0/0."
  - "The chosen approach and the rejected alternatives are recorded in a comment."
description: "GitHub #362. Severity: high — unbounded token sink that no monitoring surface detects.\n\nFAILURE SCENARIO\nRun f4baa5e6 launched the full test suite as a background task and blocked on it. The machine slept, the suite process died, the agent never noticed, and it repeated this for roughly 80 minutes: relaunch the suite, sleep 90s, block on the dead task for up to 10 minutes, re-read the same unchanged git diff, repeat — about a dozen times. It only ended because a human interrupted it.\n\nNothing caught it. lastActivityAt advances on every tool call and polling IS a tool call, so the heartbeat monitor saw maximal activity. The run record reported 0 turns and 0 tokens while the loop ran, so the dashboard showed it as idle. The task consumed 16,002,054 cache-read tokens across 40 turns, most of it re-reading the same diff.\n\nSOLUTION — needs a design decision, so start by choosing between these rather than implementing blind:\n(A) Repeated-identical-tool-call detector: N consecutive calls with the same tool and arguments returning the same result is a livelock; fail the turn naming the repeated call. Most targeted; needs a threshold and a definition of \"same result\".\n(B) Wall-clock cap per task, separate from maxTurns. Simple and catches every shape of stall, but needs a default that does not kill legitimately long tasks.\n(C) Treat blocking on a dead background task as an error rather than a timeout. Fixes this instance precisely; does not catch other livelocks.\n\n(A) plus (C) is probably the right pair. Whatever is chosen, record the reasoning in the code.\n\nSECOND DEFECT, worth fixing alongside: the run record showed 0 turns and 0 tokens for a run that was 40 turns deep, so the periodic save was not carrying the counters. Check that separately — the dashboard's view of a running task depends on it."
lastModified: "2026-09-11T22:32:11.553Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
