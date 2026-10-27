---
id: "ed9b7154-5527-4646-b421-dc25b5095a84"
type: "change"
title: "Implement self-heal loop auto-termination when all self-heal items are completed"
slug: "implement-self-heal-loop-auto"
intent: "After each hench iteration within a self-heal run, check whether any pending self-heal tagged items remain. If none remain, exit the loop cleanly and report completion — rather than continuing to the next generic PRD task or looping indefinitely."
acceptanceCriteria:
  - "Loop exits with a success message when zero pending 'self-heal' items remain"
  - "Loop does NOT continue to non-self-heal tasks after completing all self-heal items"
  - "Termination condition is evaluated after each completed task, not only at loop start"
  - "Final status output lists the self-heal items resolved in the run and their outcome"
amends: [{"target":"ae28134a-cb7d-4427-87f0-55094e3500d0","delta":"modified","summary":"Implement self-heal loop auto-termination when all self-heal items are completed","base":"7298694a23c551c32603de0228b708e02ba3fb86ec5f5b83ece90c4c0eb98605"}]
priority: "critical"
tags:
  - "self-heal"
  - "hench"
source: "smart-add"
---
