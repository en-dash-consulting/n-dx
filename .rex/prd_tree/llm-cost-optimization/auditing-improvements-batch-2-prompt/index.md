---
id: "4383553b-412b-4ac0-9346-d5741e79ce1b"
level: "feature"
title: "Auditing improvements batch 2 — prompt caching, prune quality, primer wiring"
status: "completed"
priority: "high"
startedAt: "2026-09-04T18:38:59.387Z"
completedAt: "2026-09-04T18:38:59.387Z"
endedAt: "2026-09-04T18:38:59.387Z"
acceptanceCriteria: []
description: "Follow-up to the 2026-08 token audit. Batch 1 (PRs #341, #346) landed light-tier routing, the class-to-tier registry, artifact caps and CLI session forking. Three gaps remain, verified against main at c1a6cc81: (1) the API-mode agent loop uses no prompt caching at all - zero cache_control breakpoints monorepo-wide, so the system prompt and TOOL_DEFINITIONS are re-sent at full price every turn; (2) pruneMessages splices from index 1, silently discarding the oldest turns with no summary and invalidating any cache prefix; (3) sourcevision generates .sourcevision/PRIMER.md but nothing reads it - assembleNdxContext still pipes the full CONTEXT.md and hench's orientation session re-explores the repo with an LLM. Also: the context.summarize light-tier task class has no call site."
lastModified: "2026-09-04T18:39:01.657Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Prompt caching in the API agent loop (cache_control breakpoints)](./prompt-caching-in-the-api-agent-loop.md) | completed |
| [Summarizing prune that preserves the cache prefix](./summarizing-prune-that-preserves-the.md) | completed |
| [Wire the sourcevision PRIMER.md into ndx work and hench orientation](./wire-the-sourcevision-primer-md-into.md) | completed |
