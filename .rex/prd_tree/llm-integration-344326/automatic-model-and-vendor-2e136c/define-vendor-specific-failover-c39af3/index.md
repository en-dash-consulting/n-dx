---
id: "c39af3ae-f049-4e93-8892-d4773cdc8501"
level: "task"
title: "Define vendor-specific failover chains and selection policy in llm-client"
status: "pending"
priority: "high"
tags:
  - "llm"
  - "self-heal-items"
source: "smart-add"
acceptanceCriteria:
  - "Pure function returns the ordered failover sequence for a given starting (vendor, model) — Claude-origin and Codex-origin both covered"
  - "Concrete model IDs come from the existing tier registry / resolveVendorModel and are not hardcoded literals in the chain"
  - "Chain terminates after the documented number of attempts and reports exhaustion distinctly from per-step failure"
  - "Unit tests cover Claude-origin chain, Codex-origin chain, mid-chain success, and full exhaustion"
description: "Encode the ordered failover chains in the llm-client foundation: when active vendor is Claude (sonnet primary), try haiku, then a codex model, then a second codex model; when active vendor is codex, try a second codex model, then claude sonnet, then claude haiku. Resolve concrete model IDs through the existing model tier registry / resolveVendorModel rather than hardcoding strings, and stop at the first success or after the chain is exhausted. Expose a pure helper that returns the next (vendor, model) pair given the current attempt state and the originating vendor/model."
---

# Define vendor-specific failover chains and selection policy in llm-client

🟠 [pending]

## Summary

Encode the ordered failover chains in the llm-client foundation: when active vendor is Claude (sonnet primary), try haiku, then a codex model, then a second codex model; when active vendor is codex, try a second codex model, then claude sonnet, then claude haiku. Resolve concrete model IDs through the existing model tier registry / resolveVendorModel rather than hardcoding strings, and stop at the first success or after the chain is exhausted. Expose a pure helper that returns the next (vendor, model) pair given the current attempt state and the originating vendor/model.

## Info

- **Status:** pending
- **Priority:** high
- **Tags:** llm, self-heal-items
- **Level:** task
