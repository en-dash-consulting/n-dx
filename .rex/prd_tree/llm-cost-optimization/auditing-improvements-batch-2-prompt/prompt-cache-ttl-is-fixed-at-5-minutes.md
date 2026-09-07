---
id: "dbc469d2-88fd-4221-825a-65ae3c3b19ce"
level: "task"
title: "Prompt cache TTL is fixed at 5 minutes, so tool calls longer than about 4 minutes rewrite the whole conversation at the cache-write price"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "hench"
  - "prompt-cache"
  - "config"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "hench config schema accepts `promptCacheTtl` with values `5m` and `1h` (default `5m`) and rejects other values with an actionable error"
  - "With `promptCacheTtl: \"1h\"`, both cache_control markers in the built request carry `ttl: \"1h\"`"
  - "With the default, the built request is byte-identical to the current PR (existing prompt-cache tests pass)"
  - "A unit test covers the 1h path and fails on the current code"
  - "Config documentation states the 2x write cost and the 5 to 60 minute gap where 1h pays off"
description: "Severity: low. Verdict: should-fix (user elected to address). Found by the adversarial review of PR #353.\n\n## Observation\nBoth breakpoints in packages/hench/src/agent/lifecycle/prompt-cache.ts:41 use `{ type: \"ephemeral\" }`, the 5-minute TTL. Anthropic measures the TTL from the start of the request that wrote or read the entry, so generation time counts against it. A turn whose tool call runs a long test suite (the test-runner and local loop allow 5 minutes) leaves the next request outside the window: the conversation prefix is re-written at 1.25x input price instead of read at 0.1x, for up to 20 pairs plus system and tools. The 1-hour TTL costs 2x on writes and only pays off when start-to-start gaps between turns regularly fall in the 5 to 60 minute range, so it should be opt-in per project. Entries with the longer TTL must appear before shorter ones, so both breakpoints must share one TTL.\n\n## Reachability\nAny API-mode run whose tool calls exceed roughly 4 minutes; common for projects with slow test suites.\n\n## Solution options\n1. (Recommended) Add `hench.promptCacheTtl: \"5m\" | \"1h\"` (default `\"5m\"`). When `\"1h\"`, both markers carry `ttl: \"1h\"`. Document the break-even so users only enable it when their turns are slow. Cost: trivial. Risk: none at the default.\n2. Choose the TTL adaptively from measured tool latency. Over-engineered for the size of the effect.\n\nOption 1 mirrors the SDK's own knob."
lastModified: "2026-09-07T20:28:48.046Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
