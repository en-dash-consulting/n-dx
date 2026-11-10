---
id: "2ed4fe07-80f0-42dc-ab50-db4c2eb42e65"
type: "task"
title: "ndx pair-programming's hench runs carry no NDX_AGENT_RUN marker, so its agent can run ndx migrate"
slug: "ndx-pair-programming-s-hench-runs"
description: "Found by the adversarial review of 315b10e0 (run 4c45fe7d). Verdict: should-fix; S2-Q5 named only ndx work and ndx self-heal, so it was not widened here.\n\nScenario: `ndx pair-programming \"<desc>\" .` on a v1 project spawns `hench run --task=<id>` (packages/core/cli.js ~3253) and the remediation run (~3313) with plain `run(tools.hench, …)`, not `runAgentOrDie`. The agent session gets neither NDX_AGENT_RUN=1 nor NDX_LEGACY_NOTICE=off (the latter only when pair-programming is not in LEGACY_NOTICE_COMMANDS — it is not). Its shelled-out rex commands print \"Run 'ndx migrate'\", and `ndx migrate` is not refused inside it — the exact vector bf27fa7e / 315b10e0 closed for work and self-heal.\n\nReachable: yes, any `ndx pair-programming` run (CLI command, dashboard parity).\n\nOptions:\n1. (Recommended) Pass AGENT_RUN_ENV on both hench spawns in handlePairProgramming (`run(tools.hench, args, AGENT_RUN_ENV)`); extend tests/e2e/cli-agent-run-env.test.js with a pair-programming case. Cheap; no risk.\n2. Make every core `hench run` spawn go through one helper so a future caller cannot forget the marker. Slightly more churn."
acceptanceCriteria:
  - "Both hench run children of ndx pair-programming receive NDX_AGENT_RUN=1 and NDX_LEGACY_NOTICE=off (e2e test pinning the spawned env, fails today)"
  - "ndx pair-programming on a v1 project prints the v1 notice at most once"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-23"
  - "lane-migration"
  - "core"
source: "ndx-adversarial-review"
---
