---
id: "ed8c0710-646f-485a-bdf4-802c67fff5be"
type: "change"
title: "A local-vendor run whose brief is too large stays running and leaks its SIGINT handler"
slug: "a-local-vendor-run-whose-brief-is-too"
intent: "packages/hench/src/agent/lifecycle/loop.ts runLocalToolLoop: the heartbeat (~1597) and SIGINT trap (~1599) start before the \"Brief too large for configured context window\" throw (~1621), which sits outside the try (~1649); buildToolContext is in the same window. Effects: the SIGINT listener leaks, the heartbeat keeps rewriting the run record as \"running\", handleRunFailure never runs so the task stays in_progress, and finalizeRun never closes the run log or events file. Repro: `llm.vendor=local`, `llm.local.maxContextTokens=100`, `ndx work` on any task — `.hench/runs/<id>.json` keeps `status: \"running\"`.\n\nReachable: yes, any local-vendor run with a small context window.\n\nFix options: (1, recommended) move the size check (and buildToolContext) inside the try so the existing failure path runs; small. (2) check the brief size before starting the heartbeat and trap; also small but leaves buildToolContext exposed.\n\nVerdict: out-of-scope for the streamline refactor stack (pre-existing, found by its adversarial review, 2026-11-15); worth fixing on its own."
acceptanceCriteria:
  - "A local-vendor run whose brief exceeds the context window ends with a failed run record, the task out of in_progress, and no SIGINT listener left installed"
  - "A test reproduces the oversized brief and asserts the run record status and the listener count"
priority: "high"
source: "ndx-adversarial-review"
---
