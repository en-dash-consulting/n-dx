---
id: "5b154933-05e7-4696-bb8a-20726cf1a068"
level: "task"
title: "routes-commands ndx-ladder tests leak the ambient NDX_CLI_PATH env var"
status: "pending"
priority: "medium"
acceptanceCriteria: []
description: "packages/web/tests/unit/server/routes-commands.test.ts, describe block 'commands route — ndx binary resolution ladder', fails on any machine where NDX_CLI_PATH is exported (e.g. an ndx dev-link install). Two tests fail: 'prefers the project-local .bin/ndx when present' (receives \"node\") and 'uses N_DX_CLI_PATH when set and no local bin exists' (receives the ambient dev-link cli.js path).\n\nRoot cause: resolveNdxBin() in packages/web/src/server/routes-commands.ts has an undocumented rung 0 — if (process.env.NDX_CLI_PATH) return { bin: 'node', args: [process.env.NDX_CLI_PATH] } — that short-circuits above every rung the ladder doc comment describes. The test hooks save and restore only N_DX_CLI_PATH (with the underscore), never NDX_CLI_PATH, so the ambient value wins and the assertions exercise the wrong rung.\n\nNot a regression: reproduced in isolation on hotfix/sv-analyze-skip-worktree-scans, unrelated to that branch's diff, and green in CI where NDX_CLI_PATH is unset. It is a hermeticity gap that makes the suite red for any contributor using the dev-link workflow.\n\nFix: delete/restore NDX_CLI_PATH alongside N_DX_CLI_PATH in the describe block's hooks, and extend the resolveNdxBin doc comment to document rung 0 (it currently numbers the ladder 1-4 starting at the project-local bin, which is really rung 2). Add a test covering rung 0 so it stops being invisible."
lastModified: "2026-09-07T22:41:41.764Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
