---
id: "d08b0479-1b28-4fd9-a2b7-e3247dd2ea28"
level: "task"
title: "Run the post-merge measurement batch and record the comparison with the baseline"
status: "pending"
priority: "high"
tags:
  - "0.7.1"
  - "cost-measurement"
  - "wm-2054"
  - "non-code"
blockedBy:
  - "2b86bc48-6cab-4cd1-bc15-b05ee38fc14d"
  - "cce8f62c-8660-4157-9dd2-722a64baa62b"
  - "2e4d0c5e-3a2f-496b-809b-be4a2953979f"
source: "caos work management: WM2054 (Run the post-merge measurement batch and record the comparison with the baseline); 0.7.1 execution plan PR group"
acceptanceCriteria:
  - "The stable checkout used by the global `ndx` is at the 0.7.1 tag (verified with `ndx which`)."
  - "A batch of ndx work tasks comparable in count and size to the baseline's 10 runs has run to completion."
  - "docs/analysis/prompt-token-batch-2-results.md records per-run and total input, output, cache-write and cache-read tokens and per-model cost from `hench show` and `ndx usage`, the delta against $247.53, and a recommendation on the prune trigger/retain defaults (20/10 today)."
  - "The results document is committed and linked from the baseline document."
description: "The optimization work has only ever been verified by tests. The baseline is 10 autonomous runs at $247.53 (434.2M tokens, 426.9M of them cache reads) recorded in docs/analysis/prompt-token-baseline.md before the caching, prune and primer changes. Run a comparable batch on the published 0.7.1 build and record the before-and-after with all four token classes and per-model cost. Budget roughly $100 to $250 of agent spend. The global `ndx` on the maintainer's machine is a pnpm link to a separate stable checkout, so that checkout must be moved to the 0.7.1 tag first or the batch measures the wrong code.\n\nImplementation notes: After 0.7.1 is published with the per-model pricing and run-count fixes, update the stable checkout behind the global ndx link to the 0.7.1 tag and confirm with `ndx which`. Select a batch of pending rex tasks comparable to the baseline batch in count (about 10) and scope, run them with `ndx work` (autonomous mode, same provider and model as the baseline), and collect per-run token classes with `hench show` and totals with `ndx usage --format=json`. Write docs/analysis/prompt-token-batch-2-results.md with the table of runs, totals per token class and per model, the cost delta against the $247.53 baseline, observed cache-hit behaviour, and a recommendation for the prune defaults. Link it from docs/analysis/prompt-token-baseline.md. Non-code apart from the docs commit."
lastModified: "2026-09-21T17:24:21.740Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
