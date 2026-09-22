---
id: "34c7a43d-10f1-48c3-96a6-b9199e80bfd7"
level: "task"
title: "ndx usage counts hench turns as calls in the per-command breakdown, reporting 1459 runs where the package line says 8"
status: "pending"
priority: "low"
acceptanceCriteria: []
description: "Observed while verifying task e4ab52b8 (per-model cost pricing); pre-existing, not introduced by it. 'ndx rex usage .' on this repo prints 'hench: 333,993,147 tokens ... - 8 runs' under 'By package' and 'hench run: 333,993,147 tokens ... - 1459 runs' under 'By command', for the same tokens. Cause: extractHenchTokenUsage (packages/rex/src/core/token-usage.ts) counts one call per run file, while extractHenchTokenEvents fans a run out into one event per turnTokenUsage entry, each with calls: 1. groupByCommand sums those, so the per-command line counts turns and labels them 'runs'. The same inflated count reaches the --group period buckets via eventsToAggregate. Fix either by having the event stream carry one call per run (attributing turns as a separate dimension) or by labelling the unit 'turns' for hench - but the two surfaces must not disagree on the same word. Note the per-model split deliberately carries no call count for this reason; that decision is documented on PackageTokenUsage.byModel. Acceptance: (1) the 'By package' and 'By command' lines report the same unit for the same hench data, or label their units distinctly; (2) period buckets agree with the totals on call counts; (3) a test pins the call count for a multi-turn hench run across the package, command and period surfaces."
lastModified: "2026-09-09T22:13:42.161Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
