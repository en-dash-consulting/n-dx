---
id: "a6c968d3-f0a8-490b-8b8c-f3a07c5ce4e5"
level: "task"
title: "Integrate failover loop into hench run with original-config restore and error parity"
status: "pending"
priority: "high"
tags:
  - "llm"
  - "hench"
  - "self-heal-items"
source: "smart-add"
acceptanceCriteria:
  - "With flag off, run behavior and error surface are byte-identical to the pre-change baseline (covered by regression test)"
  - "With flag on, a quota failure on the primary advances to the next chain entry and the run completes if any fallback succeeds"
  - "Each failover switch logs a single colored line naming prior vendor/model, new vendor/model, and the classified error reason"
  - "Full chain exhaustion restores the original vendor/model in active config state and rethrows the original error unchanged"
  - "Non-retryable errors (e.g., user cancellation, code defects) bypass the failover loop and surface immediately"
  - "Integration tests cover Claude-origin success-on-haiku, Codex-origin success-on-claude, full exhaustion restore-and-rethrow, and flag-off no-op"
description: "Wrap the hench run LLM invocation so that when llm.autoFailover is true and the call fails with a classified retryable error (quota, rate limit, auth, model unavailable — reuse the shared LLM error classifier), it walks the failover chain, swapping vendor/model per attempt and emitting a clear log line for each switch (`[failover] claude/sonnet → claude/haiku: quota exhausted`). On any successful attempt, continue the run normally. If the entire chain fails, restore the original vendor/model selection in process state and rethrow the original error verbatim — the user-visible error must match the autoFailover=false path exactly. When the flag is false, the path is a no-op."
---

# Integrate failover loop into hench run with original-config restore and error parity

🟠 [pending]

## Summary

Wrap the hench run LLM invocation so that when llm.autoFailover is true and the call fails with a classified retryable error (quota, rate limit, auth, model unavailable — reuse the shared LLM error classifier), it walks the failover chain, swapping vendor/model per attempt and emitting a clear log line for each switch (`[failover] claude/sonnet → claude/haiku: quota exhausted`). On any successful attempt, continue the run normally. If the entire chain fails, restore the original vendor/model selection in process state and rethrow the original error verbatim — the user-visible error must match the autoFailover=false path exactly. When the flag is false, the path is a no-op.

## Info

- **Status:** pending
- **Priority:** high
- **Tags:** llm, hench, self-heal-items
- **Level:** task
