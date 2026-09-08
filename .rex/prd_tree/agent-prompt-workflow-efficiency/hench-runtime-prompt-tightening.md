---
id: "555604fb-68dc-454d-a857-712bf347f233"
level: "feature"
title: "Hench Runtime Prompt Tightening"
status: "pending"
priority: "high"
tags:
  - "prompts"
  - "hench"
  - "tokens"
blockedBy:
  - "76076f6a-c23c-4905-864b-5218a5a6ee69"
source: "ndx-capture"
acceptanceCriteria:
  - "Each brief section earns its place: any section that the agent demonstrably ignores or re-derives from the codebase anyway is cut or replaced with a pointer."
  - "The brief states the intended change and its scope boundary explicitly, so the agent does not widen or narrow the work on its own judgement."
  - "Plan-mode instruction across brief.ts, plan-mode-prompt.ts, and the no-plan-mode system prompt is reconciled into one consistent directive with no contradiction between surfaces."
  - "PREVIOUS FAILURE context is phrased as a specific corrective instruction rather than raw prior output, so a retry does not repeat the failed approach."
  - "Assembled-brief token count for the representative task drops measurably against the recorded baseline."
  - "Existing hench tests pass, and a run against a representative task produces the same file changes as before the rewrite."
description: "Rewrite the prompts hench sends on every autonomous run: packages/hench/src/agent/planning/brief.ts (the assembled task brief, the largest surface at ~397 lines), planning/prompt.ts, lifecycle/plan-mode-prompt.ts, and lifecycle/prompt-diagnostics.ts. The brief currently accretes sections — task, parent, siblings, previous failure, acceptance criteria, tags — and each section is a candidate for either sharpening or removal. Target: the agent reads the brief once and knows exactly which change to make, without a discovery phase the brief could have short-circuited."
lastModified: "2026-09-08T13:07:52.308Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
