---
id: "315b10e0-2aa5-4051-bca8-65a2c91cdb32"
level: "task"
title: "ndx self-heal, start and web silence the v1 notice for their children, and ndx migrate refuses inside an agent run"
status: "completed"
priority: "medium"
tags:
  - "pr-23"
  - "lane-migration"
  - "review-2026-10-12"
blockedBy:
  - "7d0695e3-3ba0-43f5-9662-08b766f66f07"
source: "review-2026-10-12"
startedAt: "2026-10-15T04:34:59.723Z"
completedAt: "2026-10-15T04:42:17.309Z"
endedAt: "2026-10-15T04:42:17.309Z"
resolutionType: "code-change"
resolutionDetail: "LEGACY_NOTICE_COMMANDS gains self-heal/start/web; work and self-heal spawn hench with NDX_AGENT_RUN=1 + NDX_LEGACY_NOTICE=off (runAgentOrDie); handleMigrate refuses under NDX_AGENT_RUN. Pinned by tests/e2e/cli-agent-run-env.test.js."
acceptanceCriteria:
  - "self-heal, start and web are in LEGACY_NOTICE_COMMANDS; ndx self-heal on a v1 project prints the notice once and its rex and hench children receive NDX_LEGACY_NOTICE=off (test)"
  - "ndx work's and ndx self-heal's hench child receives NDX_LEGACY_NOTICE=off and NDX_AGENT_RUN=1 (test pinning the spawned env; bf27fa7e criterion 2)"
  - "ndx migrate --plan, --apply and the bare chain exit non-zero with NDX_AGENT_RUN=1 set and write nothing (test; fails at a7f2c007da)"
  - "An operator's own rex command on a v1 tree still prints the notice once, and ndx migrate runs normally without the marker (existing tests pass)"
description: "Review of #691 (2026-10-12), should-fix 4, CONFIRMED (traced), plus bf27fa7e (folded; Ryan decided 2026-10-12, S2-Q5 option 1).\n\n1. packages/core/cli.js:526: LEGACY_NOTICE_COMMANDS lacks self-heal, start and web. self-heal spawns rex recommend 2-3 times plus hench run --auto --loop (cli.js:2697-2760), so the notice repeats, and its hench agents inherit no NDX_LEGACY_NOTICE=off and see \"Run 'ndx migrate'\" on every shelled-out rex command (bf27fa7e's vector, which ndx work already avoids). start and web do not silence their children either (the dashboard surfacing it in error text is 40017134, out of scope here).\n\n2. Nothing stops an agent from running ndx migrate. This repository's hench allowlist includes npx and node, so 'npx ndx migrate --plan --rules-only . && npx ndx migrate --apply .' would run inside an agent session. Hench puts no run marker in its children's environment today (checked stack 2, stack 1 and main: only NDX_CLI_PATH / N_DX_CLI_PATH, which core sets for every child).\n\nDecision S2-Q5 (Ryan, 2026-10-12, option 1): ndx work and ndx self-heal export a dedicated marker, NDX_AGENT_RUN=1, into the environment of the hench they spawn (core only, no hench change). ndx migrate (every form: --plan, --apply, the bare chain) refuses when NDX_AGENT_RUN is set, saying an operator runs the migration from their own shell. Keep it minimal."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-15T04:42:17.601Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
