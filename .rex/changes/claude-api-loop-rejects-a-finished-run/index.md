---
id: "e2d0ec97-6fa9-49d7-825d-1510ccc0734c"
type: "change"
title: "Claude API loop rejects a finished run as plan-only when its last turn is text after earlier code edits"
slug: "claude-api-loop-rejects-a-finished-run"
summary: "When hench drives Claude through the API, a run that made its changes and then said it was done is treated as if it only wrote a plan, re-prompted twice and then failed. Fixing it lets genuine completions through."
intent: "Found by the adversarial review of task feb4f772 (validation-slot abort signal); pre-existing, out of scope there.\n\nFailure: packages/hench/src/agent/lifecycle/loop.ts:2221-2244 (Claude API loop, provider=api, vendor claude). `detectPlanOnlyIteration(assistantContent)` looks only at the final end_turn message. A run whose earlier turns called write_file / edit_file and whose last turn is a plain text summary (\"Done — the file is written.\") gets isPlanOnly=true, is re-prompted planOnlyMaxRetries (default 2) times, and then fails with \"Plan-only completion\" even though the changes are on disk. Reproduced in packages/hench/tests/integration/claude-api-completion-slot-abort.test.ts: with the default planOnlyMaxRetries the scripted write → git add → commit-msg → text end_turn run failed \"Plan-only completion…after 2 re-prompts\" (the test now sets planOnlyMaxRetries=0 to work around it). `runHasCodeModifications(run.toolCalls)` exists in agent/analysis/plan-only-detection.ts for exactly this, but nothing in lifecycle calls it.\n\nReachability: every Claude API run that ends the normal way (a text-only end_turn after tool turns). The CLI loops and the Gemini/local loops do not use this check.\n\nOptions:\n1. (Recommended) Treat the terminal turn as plan-only only when neither it nor the run's earlier tool calls modified code: `planDetection.isPlanOnly && !runHasCodeModifications(run.toolCalls)`. One condition, at both checks (end_turn and the non-tool_use branch); low risk, as completion validation still rejects runs with no changes.\n2. Drop the API-loop plan-only check and rely on rejectUnvalidatedCompletion, which already fails no-change completions. Bigger behaviour change; loses the re-prompt.\n\nVerdict: out-of-scope for the reviewed change; high severity because it breaks normal completions on a supported provider."
acceptanceCriteria:
  - "A Claude API run whose earlier turns modified code and whose final end_turn is text only completes without a plan-only re-prompt"
  - "A Claude API run that never issued a code-modifying tool call is still re-prompted and then failed as plan-only completion"
  - "An integration test drives the Claude API loop with the default planOnlyMaxRetries through write_file then a text-only end_turn and asserts the run is not failed as plan-only"
  - "claude-api-completion-slot-abort.test.ts no longer needs planOnlyMaxRetries = 0"
touches:
  - "e08fe050-bded-4ff2-9e4f-46d55cbfc93f"
priority: "high"
discoveredFrom: {"item":"feb4f772-7b1a-4273-8365-a618fb1bdf8e","run":"13fdbe81-12b2-4969-af53-0ce27234d004"}
tags:
  - "ndx-adversarial-review"
  - "severity:high"
  - "hench"
  - "agent-loop"
source: "ndx-adversarial-review"
---
