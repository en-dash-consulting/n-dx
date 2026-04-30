---
id: "8d493315-ede5-4370-bae3-901630c5ec02"
level: "task"
title: "Detect plan-only completions and re-prompt the agent to execute before allowing run completion"
status: "in_progress"
priority: "high"
tags:
  - "hench"
  - "agent-loop"
  - "reliability"
source: "smart-add"
startedAt: "2026-04-30T19:34:47.206Z"
acceptanceCriteria:
  - "Run loop classifies each iteration as 'planned-only' vs 'executed' based on whether code-modifying tool calls were issued"
  - "A planned-only terminal iteration triggers an automatic re-prompt requiring execution before the run can be marked complete"
  - "Re-prompt is bounded by a configurable max-retry count (default 2) before surfacing a failed run with reason 'plan-only completion'"
  - "Integration test reproduces the scenario where the agent emits a plan and asserts execution is forced before completion"
  - "Behavior gated off cleanly for pair-programming/review-only modes that legitimately produce plans without execution"
description: "Add a guard in the hench run loop that classifies the agent's output: if the run would complete with a plan/intent message but no edit, write, or shell tool calls touching code files, treat it as a plan-only iteration and re-prompt the agent with an explicit 'execute the plan you just stated' directive. Prevents the failure mode where hench finishes a task by printing intent and exits clean."
---

# Detect plan-only completions and re-prompt the agent to execute before allowing run completion

🟠 [in_progress]

## Summary

Add a guard in the hench run loop that classifies the agent's output: if the run would complete with a plan/intent message but no edit, write, or shell tool calls touching code files, treat it as a plan-only iteration and re-prompt the agent with an explicit 'execute the plan you just stated' directive. Prevents the failure mode where hench finishes a task by printing intent and exits clean.

## Info

- **Status:** in_progress
- **Priority:** high
- **Tags:** hench, agent-loop, reliability
- **Level:** task
- **Started:** 2026-04-30T19:34:47.206Z
