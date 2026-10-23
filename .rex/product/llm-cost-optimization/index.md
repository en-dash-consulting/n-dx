---
id: "ec1fc708-5fc1-4cad-adc2-198f0bdb8175"
type: "area"
title: "LLM Cost Optimization"
slug: "llm-cost-optimization"
summary: "Reduce LLM token spend across hench, rex, sourcevision, and llm-client. Derived from the 2026-08 token-spend audit and the routing/session-architecture design doc; scope and file-level touch points are recorded in docs/analysis/llm-cost-optimization-plan.md on branch feat/llm-cost-optimizations. Seven work streams: light-tier routing for mechanical calls, cold-spawn elimination, artifact diet, JSON prompt discipline, per-task spawn caps, tiered model wiring (class → tier → model), and targeted retry escalation. Measurement gate: the CLI token-telemetry fix (PR in flight) must land before routing/session defaults are locked; success criteria are ≥60% cost reduction on multi-task ndx work --loop and ≥40% on ndx plan / ndx ci with quality flat or better."
tags:
  - "llm"
  - "cost"
  - "optimization"
source: "ndx-capture"
priority: "high"
---
