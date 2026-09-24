---
id: "20ecdcad-479f-414f-ba16-022af8560aa3"
level: "task"
title: "Resume a CLI work session that ended waiting on a background command"
status: "pending"
priority: "high"
tags:
  - "0.7.1"
  - "pr-bg"
  - "hench"
  - "run-lifecycle"
  - "cli-loop"
source: "PR M execution, 2026-09-24 (run 01d15d75)"
acceptanceCriteria:
  - "A stream fixture ending with a `run_in_background: true` Bash call and no commit produces exactly one resume with the fixed message, and the resumed session's commit completes the run."
  - "The same detection fires for a ScheduleWakeup or Monitor tool_use."
  - "A second background-and-end after the resume fails the run with a message naming the cause, and no third spawn happens."
  - "A session that backgrounds a command but still commits and finishes normally is not resumed."
  - "The run record notes the resume, so a run that needed one is distinguishable from one that did not."
  - "The changeset states that this closes the gap left by foreground-invariant-autonomous-runs.md."
description: "Detect, from the stream-json events, a work session that started a background command and then ended without finishing: a `Bash` tool_use whose input has `run_in_background: true`, or any `ScheduleWakeup` or `Monitor` tool_use. When such a session ends with the task's work uncommitted, do not finalize. Resume it once with `--resume <sessionId>` and a fixed message, along the lines of: \"Nothing will notify you: this run is non-interactive. Run the command again in the foreground, wait for it to exit, then finish: commit, update status, summary.\" If the resumed session ends the same way, fail as today.\n\nModel it on `planModeIntercept` in `packages/hench/src/agent/lifecycle/cli-loop.ts` (~line 173): a field on the spawn result that the outer `cliLoop` reads. Region check before starting: M edited the post-run budget check (~1600) and I owns the retry line (~1728)."
lastModified: "2026-09-24T20:29:56.512Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
