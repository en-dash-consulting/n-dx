---
id: "c1b8bb00-116c-4451-9eab-5a646c489378"
level: "task"
title: "ndx work prints an identity line at start: version, cli path, project dir, branch"
status: "pending"
priority: "medium"
tags:
  - "pr-07"
  - "core"
  - "hench"
source: "parallel-development roadmap, 2026-09-10 discovery session"
acceptanceCriteria:
  - "`ndx work --dry-run .` shows the identity line first."
  - "The line appears once in the dashboard's live output for a run started from the UI."
description: "In packages/core/cli.js handleWork (~line 1837) print one line before delegating to hench: \"ndx <version> · <cliPath> · <projectDir> · <branch>\" (branch via git rev-parse in the orchestration tier; omit when not a repo). Because the dashboard streams hench stdout as the live status hint (routes-hench.ts onStdout), keep it to a single line so it shows once. Also include it in --dry-run output."
lastModified: "2026-09-10T20:11:54.675Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
