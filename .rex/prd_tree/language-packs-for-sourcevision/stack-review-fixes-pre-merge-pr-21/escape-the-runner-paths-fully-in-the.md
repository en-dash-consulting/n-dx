---
id: "d9708a62-1cf8-40bd-b12b-e276a001733a"
level: "task"
title: "Escape the runner paths fully in the CI grammar-steps test"
status: "completed"
priority: "low"
tags:
  - "review-fixes"
  - "codeql"
  - "ci"
  - "pr-21"
source: "review"
startedAt: "2026-10-20T17:18:29.989Z"
completedAt: "2026-10-20T17:21:16.538Z"
endedAt: "2026-10-20T17:21:16.538Z"
resolutionType: "code-change"
resolutionDetail: "Added escapeRegExp helper in ci-grammar-steps.test.js; both RUNNER and DECIDER regexes use it."
acceptanceCriteria:
  - "Both regexes in ci-grammar-steps.test.js escape every regex metacharacter through one helper"
  - "tests/e2e/ci-grammar-steps.test.js passes unchanged in behaviour"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
description: "**nit (CodeQL js/incomplete-sanitization on #825).** Alerts: https://github.com/en-dash-consulting/n-dx/pull/825 (tests/e2e/ci-grammar-steps.test.js lines 163 and 188).\n\n`suitesRun` and the decider check build regexes from `RUNNER` and `DECIDER` with `.replace(/[.]/g, \"\\\\.\")`, escaping only dots. Both are constant script paths, so nothing breaks today, but the pattern is wrong in general and CodeQL flags it. Add one `escapeRegExp` helper in the test (`s.replace(/[.*+?^${}()|[\\]\\\\]/g, \"\\\\$&\")`) and use it at both sites. Behaviour unchanged."
lastModified: "2026-10-20T17:21:16.855Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
