---
id: "555604fb-68dc-454d-a857-712bf347f233"
type: "capability"
title: "Hench Runtime Prompt Tightening"
slug: "hench-runtime-prompt-tightening"
statement: "Hench assembles the prompts it sends on every autonomous run (the task brief, the system prompt, the plan-mode, orientation and adversarial-review prompts) so that the agent reads the brief once and knows exactly which change to make."
criteria: [{"id":"c1","text":"The task brief shall leave out any section the agent ignores or re-derives from the codebase, or shall replace it with a pointer."},{"id":"c2","text":"The task brief shall state the intended change and its scope boundary explicitly."},{"id":"c3","text":"Hench shall give one consistent plan-mode directive across the task brief, the plan-mode prompt and the no-plan-mode system prompt, and no surface shall contradict another."},{"id":"c4","text":"Hench shall carry each instruction in only one place across the orientation prompts, the adversarial-review system prompt, the brief and the system prompt."},{"id":"c5","text":"When a task is retried after a failure, the brief shall phrase the PREVIOUS FAILURE context as a specific corrective instruction instead of raw prior output."},{"id":"c6","text":"The PromptEnvelope diagnostics shall report a token count for each section of the assembled prompt."}]
tags:
  - "prompts"
  - "hench"
  - "tokens"
source: "ndx-capture"
priority: "high"
---

Rewrite the prompts hench sends on every autonomous run. Six surfaces: packages/hench/src/agent/planning/brief.ts (the assembled task brief, ~397 lines, 33 push calls), planning/prompt.ts (buildSystemPrompt and buildPromptEnvelope, 84 push calls), lifecycle/plan-mode-prompt.ts, lifecycle/orientation.ts (buildOrientationSystemPrompt and buildOrientationPrompt), agent/analysis/adversarial-review.ts (buildReviewSystemPrompt), and lifecycle/prompt-diagnostics.ts. Because hench assembles prompts from short fragments rather than single literals, its volume must be read through the PromptEnvelope section diagnostics rather than by scanning template literals. The brief currently accretes sections — task, parent, siblings, previous failure, acceptance criteria, tags — and each is a candidate for either sharpening or removal. Target: the agent reads the brief once and knows exactly which change to make, without a discovery phase the brief could have short-circuited.
