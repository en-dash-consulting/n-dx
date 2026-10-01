---
id: "b7222413-a4fb-45f1-bfdb-fc0785982df0"
level: "task"
title: "The live analysis page's last-run times and estimate filter on exact mode, so cascade runs get none in phases 1-3 or an old run's"
status: "completed"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "live"
source: "ndx-adversarial-review"
startedAt: "2026-10-01T18:07:59.836Z"
completedAt: "2026-10-01T18:13:26.442Z"
endedAt: "2026-10-01T18:13:26.442Z"
acceptanceCriteria:
  - "During phases 1-3 of a cascade run, the previous deep or cascade run's phase times and the estimate are shown (unit test)."
  - "A fast run compares only against previous fast runs."
description: "Failure: the run ledger starts as `generative` and `setRunMode(\"cascade\")` only fires inside the zones phase (`packages/sourcevision/src/analyzers/zones.ts:2205`), while the previous-run lookup filters on exact mode (`analyze-progress.ts:76, 398, 434`). Cascade is the default whenever a judgment route resolves, so for a project whose history is all cascade, `previous` is null during inventory, imports and classifications (no estimate, no \"last\" times) and then appears mid-run; if the history holds an old pre-cascade generative line, that run's times are shown instead. The viewer already labels the comparison as \"last deep run\" (`live-analyze-model.ts:177`), which contradicts the exact-mode filter.\n\nReachability: any cascade-configured project during the first three phases. No test covers it (e2e uses --fast, unit tests fixed modes). Verdict: should-fix (severity medium).\n\nOptions:\n- Recommended: match on mode family (fast versus everything else) in the previous-run lookup. About 3 lines plus a test."
lastModified: "2026-10-01T18:13:26.828Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
