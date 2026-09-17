---
id: "4c732832-965a-4357-ae59-36790cc4106f"
level: "task"
title: "Add .hench/reviews/ to .gitignore"
status: "completed"
priority: "low"
tags:
  - "hench"
  - "review-pass"
  - "git"
source: "ndx-work-e2e-verification"
startedAt: "2026-08-31T18:42:59.662Z"
completedAt: "2026-08-31T18:47:48.517Z"
endedAt: "2026-08-31T18:47:48.517Z"
acceptanceCriteria:
  - ".hench/reviews/ is listed in .gitignore"
  - "The ndx init ignore-list template includes it if that template exists"
description: ".gitignore covers .hench/runs/, .hench/locks/, and .hench/usage-cursors/ but not .hench/reviews/, the review-report transport directory introduced by the --review pass. The pre-run gate commit uses git add -A (shared.ts:1207), so a dirty tree at the start of the next run commits machine-local review reports to the repo."
lastModified: "2026-08-31T18:47:48.522Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
