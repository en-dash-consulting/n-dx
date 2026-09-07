---
id: "5e344f0b-8cd8-4c7f-a8a8-a7c2b7b440e8"
level: "task"
title: "tokenBudget counts uncached input only, so prompt caching silently disables the budget on API runs"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "hench"
  - "token-budget"
  - "prompt-cache"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "`checkTokenBudget({input: 534, output: 40, cacheCreationInput: 876000, cacheReadInput: 34100000}, 1_000_000)` reports `exceeded: true` with `totalUsed` including both cache halves"
  - "Existing budget tests with uncached usage pass unchanged"
  - "The budget-exceeded message and `handleBudgetExceeded` report the inclusive total"
  - "The `tokenBudget` doc comment in packages/hench/src/schema/v1.ts states that cached input counts toward the budget"
  - "A unit test in the token-budget test file covers the cached case and fails on the current code"
description: "Severity: medium. Verdict: should-fix. Found by the adversarial review of PR #353.\n\n## Failure scenario\n`checkTokenBudget` (packages/hench/src/agent/lifecycle/token-budget.ts:24) computes `usage.input + usage.output`. Before PR #353 every input token on the Anthropic loop was uncached and counted. With `cache_control` breakpoints, `input` now holds only the uncached slice: the PR's own 83-turn run recorded 534 uncached input tokens against 876K cache writes and 34.1M cache reads. A configured `hench.tokenBudget` therefore bounds output plus a rounding error, and a run that used to stop at the budget now runs to `maxTurns`. The schema comment on `tokenBudget` (packages/hench/src/schema/v1.ts:134) still promises \"input + output\".\n\n## Reachability\nAny project with `hench.tokenBudget > 0` on `hench.provider=api`. Not covered by tests: the budget tests use uncached usage only.\n\n## Solution options\n1. (Recommended) Count all input at face value: `input + cacheCreationInput + cacheReadInput + output`. This restores the pre-PR meaning exactly (tokens processed per run), needs no price table, and is vendor-neutral. Update the schema comment and the budget-exceeded message. Cost: trivial.\n2. Cost-weighted total (cache writes at 1.25x, reads at 0.1x, output at the vendor's output multiple). Closer to dollars but requires a per-vendor, per-model price table that hench does not have, and changes what the number means for existing users.\n\nOption 1 was chosen because it changes no semantics; the review's first instinct was option 2, but it introduces a pricing dependency out of proportion to the defect."
lastModified: "2026-09-07T20:28:42.481Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
