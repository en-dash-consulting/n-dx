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
  - "The orientation prompts and the adversarial-review system prompt are audited on the same terms as the brief, with any instruction they duplicate from the brief or system prompt removed from one of the two."
  - "PREVIOUS FAILURE context is phrased as a specific corrective instruction rather than raw prior output, so a retry does not repeat the failed approach."
  - "Per-section token counts from the PromptEnvelope diagnostics are reported before and after, and the assembled total for the representative task drops measurably against the recorded baseline."
  - "Existing hench tests pass, including the prompt parity and envelope regression suites, and a run against a representative task produces the same file changes as before the rewrite."
description: "Rewrite the prompts hench sends on every autonomous run. Six surfaces: packages/hench/src/agent/planning/brief.ts (the assembled task brief, ~397 lines, 33 push calls), planning/prompt.ts (buildSystemPrompt and buildPromptEnvelope, 84 push calls), lifecycle/plan-mode-prompt.ts, lifecycle/orientation.ts (buildOrientationSystemPrompt and buildOrientationPrompt), agent/analysis/adversarial-review.ts (buildReviewSystemPrompt), and lifecycle/prompt-diagnostics.ts. Because hench assembles prompts from short fragments rather than single literals, its volume must be read through the PromptEnvelope section diagnostics rather than by scanning template literals. The brief currently accretes sections — task, parent, siblings, previous failure, acceptance criteria, tags — and each is a candidate for either sharpening or removal. Target: the agent reads the brief once and knows exactly which change to make, without a discovery phase the brief could have short-circuited."
lastModified: "2026-09-08T13:40:18.017Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
