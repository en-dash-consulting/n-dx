---
id: "ec1fc708-5fc1-4cad-adc2-198f0bdb8175"
level: "epic"
title: "LLM Cost Optimization"
status: "completed"
priority: "high"
tags:
  - "llm"
  - "cost"
  - "optimization"
source: "ndx-capture"
startedAt: "2026-08-31T20:38:08.835Z"
completedAt: "2026-09-04T18:39:00.235Z"
endedAt: "2026-09-04T18:39:00.235Z"
description: "Reduce LLM token spend across hench, rex, sourcevision, and llm-client. Derived from the 2026-08 token-spend audit and the routing/session-architecture design doc; scope and file-level touch points are recorded in docs/analysis/llm-cost-optimization-plan.md on branch feat/llm-cost-optimizations. Seven work streams: light-tier routing for mechanical calls, cold-spawn elimination, artifact diet, JSON prompt discipline, per-task spawn caps, tiered model wiring (class → tier → model), and targeted retry escalation. Measurement gate: the CLI token-telemetry fix (PR in flight) must land before routing/session defaults are locked; success criteria are ≥60% cost reduction on multi-task ndx work --loop and ≥40% on ndx plan / ndx ci with quality flat or better."
lastModified: "2026-09-04T18:39:00.244Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Artifact diet — cap sourcevision artifacts and startup context](./artifact-diet-cap-sourcevision/index.md) | completed |
| [Auditing improvements batch 2 — prompt caching, prune quality, primer wiring](./auditing-improvements-batch-2-prompt/index.md) | pending |
| [Eliminate per-task cold spawns (warm-parent fork + session batching)](./eliminate-per-task-cold-spawns-warm/index.md) | completed |
| [Wire tiered model resolution (task class → tier → model)](./wire-tiered-model-resolution-task/index.md) | completed |
| [Cap total spawns per task and retry via --resume](./cap-total-spawns-per-task-and-retry.md) | completed |
| [codex exec rejects the --full-auto flag, breaking autonomous codex spawns](./codex-exec-rejects-the-full-auto-flag.md) | completed |
| [Extend the batch session strategy to the codex CLI](./extend-the-batch-session-strategy-to.md) | completed |
| [JSON prompt discipline — compact JSON in and out](./json-prompt-discipline-compact-json-in.md) | completed |
| [List the known task classes in ndx config and flag an unrecognized route as probably-new, with the closest match](./list-the-known-task-classes-in-ndx.md) | completed |
| [Route commit messages and rex mechanical calls to the light tier](./route-commit-messages-and-rex.md) | completed |
| [Targeted retry escalation ladder — no more identical-prompt retries](./targeted-retry-escalation-ladder-no.md) | completed |
| [Token rollups and cost estimate exclude cache tokens, undercounting spend ~50x](./token-rollups-and-cost-estimate.md) | completed |
