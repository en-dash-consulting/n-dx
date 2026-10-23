---
id: "2e921485-212e-49b8-a00a-f6666144dee4"
type: "capability"
title: "Token rollups and cost estimate exclude cache tokens, undercounting spend ~50x"
slug: "token-rollups-and-cost-estimate"
statement: "The product rolls up run token usage, including cache-creation and cache-read input tokens, and estimates cost by pricing each token kind at its own rate."
criteria: [{"id":"c1","text":"When rolling up token usage from run records, the system shall include cacheCreationInput and cacheReadInput tokens alongside input and output tokens in the total."},{"id":"c2","text":"When estimating cost, the system shall price cache reads and cache writes at their own rates rather than ignoring them."},{"id":"c3","text":"When given the same run set, `ndx usage`, `ndx status` and the dashboard shall report the same token total."},{"id":"c4","text":"When reporting token usage, the system shall show fresh input, cache writes and cache reads as separate figures rather than one combined number."}]
requirements: [{"id":"2e921485-212e-49b8-a00a-f6666144dee4:c1","title":"When rolling up token usage from run records, the system shall include cacheCreationInput and cacheReadInput tokens alongside input and output tokens in the total","description":"Linked to: packages/rex/tests/unit/core/token-cache-accounting.test.ts","category":"technical","validationType":"automated","acceptanceCriteria":["When rolling up token usage from run records, the system shall include cacheCreationInput and cacheReadInput tokens alongside input and output tokens in the total."]}]
source: "ndx-capture"
priority: "high"
---

Run records store four token fields (input, output, cacheCreationInput, cacheReadInput) but every rollup sums only input + output. packages/rex/src/cli/commands/usage.ts:43 is `const total = pkg.inputTokens + pkg.outputTokens`, and the same omission reaches `ndx status` and the dashboard. Measured: `ndx usage` reports 1,212,931 tokens and an $18.00 estimate across 1,024 runs, while a single assisted run record written today holds 22,785,751 cacheReadInput tokens — 99.5% of that run's usage. `hench record` prints the cache-inclusive total, so the two surfaces disagree by roughly 50x on the same data with no indication why. Cache reads and cache writes are billed (at a discount and a premium respectively), so the cost estimate is wrong, not merely partial. This matters most for the LLM Cost Optimization work: cache-read volume is the dominant term the optimizations move, and the measurement surface cannot currently see it.
