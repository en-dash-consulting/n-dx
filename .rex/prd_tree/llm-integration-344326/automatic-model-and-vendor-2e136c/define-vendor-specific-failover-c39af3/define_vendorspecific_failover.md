---
id: "c39af3ae-f049-4e93-8892-d4773cdc8501"
level: "task"
title: "Define vendor-specific failover chains and selection policy in llm-client"
status: "completed"
priority: "high"
tags:
  - "llm"
  - "self-heal-items"
source: "smart-add"
startedAt: "2026-05-06T14:49:15.236Z"
completedAt: "2026-05-06T14:52:55.748Z"
endedAt: "2026-05-06T14:52:55.748Z"
resolutionType: "code-change"
resolutionDetail: "Implemented vendor-failover.ts with pure function getNextFailoverAttempt() that encodes ordered failover chains (Claude: sonnet→haiku→codex-std→codex-light; Codex: light→claude-std→claude-light). All model IDs resolved via resolveVendorModel(), chain terminates after 3 attempts. 17 unit tests cover all chains, exhaustion, and custom config. Public API exports added."
acceptanceCriteria:
  - "Pure function returns the ordered failover sequence for a given starting (vendor, model) — Claude-origin and Codex-origin both covered"
  - "Concrete model IDs come from the existing tier registry / resolveVendorModel and are not hardcoded literals in the chain"
  - "Chain terminates after the documented number of attempts and reports exhaustion distinctly from per-step failure"
  - "Unit tests cover Claude-origin chain, Codex-origin chain, mid-chain success, and full exhaustion"
description: "Encode the ordered failover chains in the llm-client foundation: when active vendor is Claude (sonnet primary), try haiku, then a codex model, then a second codex model; when active vendor is codex, try a second codex model, then claude sonnet, then claude haiku. Resolve concrete model IDs through the existing model tier registry / resolveVendorModel rather than hardcoding strings, and stop at the first success or after the chain is exhausted. Expose a pure helper that returns the next (vendor, model) pair given the current attempt state and the originating vendor/model."
---
