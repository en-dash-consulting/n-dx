---
id: "21a5aa45-0012-477e-b64f-11a06082cd23"
level: "task"
title: "During a --deep analyze, sub-package phases are compared with the root's previous times and cost resets per package"
status: "completed"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "live"
source: "ndx-adversarial-review"
startedAt: "2026-10-01T18:14:01.318Z"
completedAt: "2026-10-01T18:19:35.698Z"
endedAt: "2026-10-01T18:19:35.698Z"
acceptanceCriteria:
  - "During a --deep run inside a sub-package, the page shows no previous-run times or estimate and labels cost per package (unit test)."
description: "Failure: the previous-run lookup (`packages/sourcevision/src/analyzers/analyze-progress.ts:398`) reads the root svDir's ledger whatever the scope, and the nested `cmdAnalyze` (`analyze.ts:395`) calls `startRunLedger` again per sub-package. While `packages/a` is analysed, its phase rows show sub-package times against the root's previous phase times, `llm` and cost so far drop to 0 at every scope change, and the estimate undercounts. The ledger reset predates this branch; the branch exposes it live.\n\nVerdict: should-fix (severity low; model side only).\n\nOptions:\n- Recommended: in the live analyze model, suppress previous times and the estimate while `progress.scope` is set or the command has --deep, and label cost as \"this package\". Cheap."
lastModified: "2026-10-01T18:19:36.084Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
