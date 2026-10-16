---
id: "306885da-bcb7-4e96-8e94-83d3ffdc4bfc"
level: "task"
title: "ndx pair-programming's remediation hench run has no test pinning NDX_AGENT_RUN"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "pr-23"
  - "lane-migration"
  - "core"
  - "v2-migrate-l7"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A test fails when AGENT_RUN_ENV is removed from the remediation hench spawn in handlePairProgramming"
  - "With a reviewer that reports issues, every hench run child of ndx pair-programming records NDX_AGENT_RUN=1 and NDX_LEGACY_NOTICE=off"
description: "Found by the adversarial review of 2ed4fe07 (run 26e2aaba). Verdict: should-fix.\n\nScenario: packages/core/cli.js handlePairProgramming passes AGENT_RUN_ENV to two hench spawns: the primary run (~3254) and the remediation run inside runReviewRounds' remediate callback (~3314). tests/e2e/cli-agent-run-env.test.js runs pair-programming with --skip-review, so only the primary spawn is exercised. If a later edit drops AGENT_RUN_ENV from the remediation spawn, its agent again runs without NDX_AGENT_RUN and can run `ndx migrate`, and no test fails. 2ed4fe07's criterion \"Both hench run children…\" is therefore verified by reading the code, not by a test.\n\nReachable: any `ndx pair-programming` run where the reviewer finds issues and rounds > 0.\n\nOptions:\n1. (Recommended) e2e case: put a fake reviewer CLI (claude/codex, matching resolveReviewerVendor) on PATH that reports a failing review, run with the child double preload, and assert two hench records with NDX_AGENT_RUN=1. Moderate cost: needs the review-output format the parser accepts.\n2. Route every core `hench run` spawn through one helper (e.g. a non-exiting runAgent(args)) and add a policy test that no `run(tools.hench, [\"run\", …])` without it exists in cli.js. Cheaper to test and prevents a future caller forgetting the marker; more churn."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-16T19:37:23.899Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
