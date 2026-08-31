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
completedAt: "2026-08-31T20:38:08.835Z"
endedAt: "2026-08-31T20:38:08.835Z"
description: "Reduce LLM token spend across hench, rex, sourcevision, and llm-client. Derived from the 2026-08 token-spend audit and the routing/session-architecture design doc; scope and file-level touch points are recorded in docs/analysis/llm-cost-optimization-plan.md on branch feat/llm-cost-optimizations. Seven work streams: light-tier routing for mechanical calls, cold-spawn elimination, artifact diet, JSON prompt discipline, per-task spawn caps, tiered model wiring (class → tier → model), and targeted retry escalation. Measurement gate: the CLI token-telemetry fix (PR in flight) must land before routing/session defaults are locked; success criteria are ≥60% cost reduction on multi-task ndx work --loop and ≥40% on ndx plan / ndx ci with quality flat or better."
lastModified: "2026-08-31T20:38:08.840Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Artifact diet — cap sourcevision artifacts and startup context](./artifact-diet-cap-sourcevision-eda610/index.md) | completed |
| [Eliminate per-task cold spawns (warm-parent fork + session batching)](./eliminate-per-task-cold-spawns-00d910/index.md) | completed |
| [Wire tiered model resolution (task class → tier → model)](./wire-tiered-model-resolution-462b95/index.md) | completed |
| [Cap total spawns per task and retry via --resume](./cap-total-spawns-per-task-and-7dcba8.md) | completed |
| [codex exec rejects the --full-auto flag, breaking autonomous codex spawns](./codex-exec-rejects-the-full-c86273.md) | completed |
| [Extend the batch session strategy to the codex CLI](./extend-the-batch-session-662bb4.md) | completed |
| [JSON prompt discipline — compact JSON in and out](./json-prompt-discipline-compact-0284c3.md) | completed |
| [List the known task classes in ndx config and flag an unrecognized route as probably-new, with the closest match](./list-the-known-task-classes-in-949f60.md) | completed |
| [Route commit messages and rex mechanical calls to the light tier](./route-commit-messages-and-rex-2db5af.md) | completed |
| [Targeted retry escalation ladder — no more identical-prompt retries](./targeted-retry-escalation-7fa8f0.md) | completed |
| [Token rollups and cost estimate exclude cache tokens, undercounting spend ~50x](./token-rollups-and-cost-estimate-2e9214.md) | pending |
