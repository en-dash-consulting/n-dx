---
id: "4200bf3a-b973-4480-87e0-f81892b6de86"
level: "task"
title: "repoCommandEnv finds the trust store from the real process environment, not the one it filters"
status: "pending"
priority: "low"
tags:
  - "security"
  - "issue-cleanup"
  - "ndx-adversarial-review"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "Closes #686 (finding 3, follow-up): the trust record repoCommandEnv reads is the one the user wrote, whatever environment the caller asks it to filter"
  - "repoCommandEnv locates the trust store from an explicit ndxHome option or process.env, never from options.env"
  - "Test: options.env without NDX_HOME on a trusted repository still honours a repository-supplied guard.env.allow entry; the test fails on the code before the fix"
description: "Hal's adversarial review of #817 (diff mode, fix/security-repo-trust...fix/security-child-env), posted 2026-10-20: https://github.com/en-dash-consulting/n-dx/pull/817, finding F3 (low, should-fix):\n\n> `repoCommandEnv(projectDir, options)` uses `options.env ?? process.env` both as the environment to sanitize and as the place `NDX_HOME` is read from to locate the trust store. A caller that passes an already-filtered env — one that dropped `NDX_HOME` — would read a different trust record than the user wrote and silently get the strict policy. No such caller exists on this branch, and the interface comment flags the coupling, so: real, unreachable today, worth a line.\n\nKept by Ryan on 2026-10-27."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-27T15:19:06.979Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
