---
id: "4383553b-412b-4ac0-9346-d5741e79ce1b"
level: "feature"
title: "Auditing improvements batch 2 — prompt caching, prune quality, primer wiring"
status: "pending"
priority: "high"
startedAt: "2026-09-04T18:38:59.387Z"
endedAt: "2026-09-04T19:56:36.318Z"
acceptanceCriteria: []
description: "Follow-up to the 2026-08 token audit. Batch 1 (PRs #341, #346) landed light-tier routing, the class-to-tier registry, artifact caps and CLI session forking. Three gaps remain, verified against main at c1a6cc81: (1) the API-mode agent loop uses no prompt caching at all - zero cache_control breakpoints monorepo-wide, so the system prompt and TOOL_DEFINITIONS are re-sent at full price every turn; (2) pruneMessages splices from index 1, silently discarding the oldest turns with no summary and invalidating any cache prefix; (3) sourcevision generates .sourcevision/PRIMER.md but nothing reads it - assembleNdxContext still pipes the full CONTEXT.md and hench's orientation session re-explores the repo with an LLM. Also: the context.summarize light-tier task class has no call site."
lastModified: "2026-09-04T22:21:25.395Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [append_log is MCP-only — no CLI equivalent, so ndx work runs cannot write execution-log entries](./append-log-is-mcp-only-no-cli.md) | pending |
| [Cost estimates price every run at Sonnet rates regardless of the model actually used](./cost-estimates-price-every-run-at.md) | completed |
| [Dashboard token-usage aggregation has no per-model split, so dashboard costs still price everything at Sonnet rates](./dashboard-token-usage-aggregation-has.md) | pending |
| [Full test gate reports 'Test gate failed: ' with 0/0 packages, dropping the timeout or exec error that actually failed it](./full-test-gate-reports-test-gate.md) | completed |
| [Full test gate timeout is hard-coded at 5 minutes, so a passing suite that runs long under load fails the run](./full-test-gate-timeout-is-hard-coded.md) | completed |
| [Keep-tail prune replays thinking blocks created before the cut, which Claude Fable 5.1's preserved-thinking check rejects](./keep-tail-prune-replays-thinking.md) | pending |
| [ndx usage counts hench turns as calls in the per-command breakdown, reporting 1459 runs where the package line says 8](./ndx-usage-counts-hench-turns-as-calls.md) | pending |
| [No way to disable cache_control breakpoints for a Claude api_endpoint that rejects them](./no-way-to-disable-cache-control.md) | pending |
| [PACKAGE_GUIDELINES .rex/ write-access protocol documented a PRD layout that no longer exists](./package-guidelines-rex-write-access.md) | completed |
| [Primer freshness check rejects a still-valid primer after any analysis that made no LLM call](./primer-freshness-check-rejects-a-still.md) | pending |
| [Prompt cache TTL is fixed at 5 minutes, so tool calls longer than about 4 minutes rewrite the whole conversation at the cache-write price](./prompt-cache-ttl-is-fixed-at-5-minutes.md) | pending |
| [Prompt caching in the API agent loop (cache_control breakpoints)](./prompt-caching-in-the-api-agent-loop.md) | completed |
| [Prune retention and transcript truncation are hard-coded, halving the verbatim window and summarizing from 800-char excerpts](./prune-retention-and-transcript.md) | pending |
| [Prune summarizer token usage is discarded, so compaction spend never reaches run records or usage rollups](./prune-summarizer-token-usage-is.md) | completed |
| [Run summary omits cache tokens, understating input ~65,000x](./run-summary-omits-cache-tokens.md) | completed |
| [Summarizing prune emits two consecutive user turns on the local and Gemini loops, which strict chat templates reject](./summarizing-prune-emits-two.md) | completed |
| [Summarizing prune that preserves the cache prefix](./summarizing-prune-that-preserves-the.md) | completed |
| [tokenBudget counts uncached input only, so prompt caching silently disables the budget on API runs](./tokenbudget-counts-uncached-input-only.md) | completed |
| [Wire the sourcevision PRIMER.md into ndx work and hench orientation](./wire-the-sourcevision-primer-md-into.md) | completed |
