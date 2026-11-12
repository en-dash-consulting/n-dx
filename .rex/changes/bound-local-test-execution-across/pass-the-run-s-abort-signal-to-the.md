---
id: "feb4f772-7b1a-4273-8365-a618fb1bdf8e"
type: "task"
title: "Pass the run's abort signal to the Claude API completion-check slot wait"
slug: "pass-the-run-s-abort-signal-to-the"
description: "PR 2 (#1034) review finding P2, should fix (comment 4556322044 on packages/hench/src/agent/lifecycle/loop.ts:2333).\n\nProblem: the Claude API path builds the completion check's validation-slot options without `signal: opts.abortSignal`, unlike the Gemini/local completion paths and this loop's tool context and finalization. With provider=api, a configured project test command, and another worktree holding the slot, a successful Claude turn queues here; the first Ctrl-C aborts the run controller in run.ts, but this acquire has no signal and keeps polling until the other holder releases, and the test can then start after cancellation. (Task a4ee4cda passed the signal from run.ts into agentLoop but missed this call site.)\n\nFix: pass the same abort signal at that call site, and check every other `validationSlot` options object in packages/hench/src/agent/lifecycle/ for the same omission.\n\nTest: cover the Claude API completion-check wait specifically (the existing local-provider gate test exercises a different path): with another holder in the slot, aborting the run's signal ends the wait without a second interrupt and the test command never starts.\n\nOperator notes: tests use an explicit temp slot directory; no `process.env.NDX_*` writes. Run the static root policy tests before finishing."
acceptanceCriteria:
  - "The Claude API completion check passes the run's abort signal to its validation-slot wait"
  - "A test shows a Claude API completion check queued behind another holder ends when the run's signal aborts, and its test command never starts"
  - "No other validationSlot options in agent/lifecycle omit the run's signal"
priority: "high"
tags:
  - "validation-gate"
  - "wave-1"
  - "pr-2-host-slot"
  - "review-fix"
source: "pr-review"
blockedBy:
  - "4b090e30-2142-4219-b274-fd8ba3a56b7e"
---
