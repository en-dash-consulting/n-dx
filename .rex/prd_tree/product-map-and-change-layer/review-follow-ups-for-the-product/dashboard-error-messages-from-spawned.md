---
id: "40017134-af63-4562-b801-4590d66715df"
level: "task"
title: "Dashboard error messages from spawned rex commands start with the v1 deprecation notice"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "pr-23"
  - "web"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "On a v1 project, a dashboard route whose rex spawn fails returns an error message that does not contain the deprecation notice"
  - "A web test asserts the rex spawn env carries NDX_LEGACY_NOTICE=off (or the error message lacks the notice)"
description: "Found by the adversarial review of 58f8f7b9 (run 4601aebf). Verdict: should-fix, low.\n\n58f8f7b9 makes multi-spawn ndx commands (ci, status, plan, add, recommend, refresh, work, analyze) print the notice once and set NDX_LEGACY_NOTICE=off for their children (packages/core/cli.js noteLegacyLayoutOnce). `ndx start`/`ndx web` are not in that set, so the web server's own rex spawns still print it. On a v1 tree, a failing rex spawn from the dashboard surfaces stderr as its error (packages/web/src/server/routes-rex-analysis.ts ~1014 `throw new Error(cliResult.stderr || …)`, and the CLI error messages in routes-commands.ts). The user sees the deprecation line ahead of the real error.\n\nReachable: any dashboard action that spawns rex and fails on a v1 project.\n\nOptions:\n1. (Recommended) Web server sets NDX_LEGACY_NOTICE=off in the env of the rex commands it spawns. Cost: one env entry per spawn site, plus a test. Risk: none; the dashboard can show the deprecation itself.\n2. Add start/web to LEGACY_NOTICE_COMMANDS in core cli.js so the env flows to the server process and its children. Cheaper, but prints the notice at server start, which a long-running server's log may bury."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T09:59:54.016Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
