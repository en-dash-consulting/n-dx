---
id: "d9708a62-1cf8-40bd-b12b-e276a001733a"
type: "task"
title: "Escape the runner paths fully in the CI grammar-steps test"
slug: "escape-the-runner-paths-fully-in-the"
description: "**nit (CodeQL js/incomplete-sanitization on #825).** Alerts: https://github.com/en-dash-consulting/n-dx/pull/825 (tests/e2e/ci-grammar-steps.test.js lines 163 and 188).\n\n`suitesRun` and the decider check build regexes from `RUNNER` and `DECIDER` with `.replace(/[.]/g, \"\\\\.\")`, escaping only dots. Both are constant script paths, so nothing breaks today, but the pattern is wrong in general and CodeQL flags it. Add one `escapeRegExp` helper in the test (`s.replace(/[.*+?^${}()|[\\]\\\\]/g, \"\\\\$&\")`) and use it at both sites. Behaviour unchanged."
acceptanceCriteria:
  - "Both regexes in ci-grammar-steps.test.js escape every regex metacharacter through one helper"
  - "tests/e2e/ci-grammar-steps.test.js passes unchanged in behaviour"
priority: "low"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
tags:
  - "review-fixes"
  - "codeql"
  - "ci"
  - "pr-21"
source: "review"
---
