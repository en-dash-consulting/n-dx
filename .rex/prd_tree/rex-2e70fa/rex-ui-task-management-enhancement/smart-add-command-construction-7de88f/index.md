---
id: "7de88f8c-5bee-4b9e-9532-7f134c7244ed"
level: "task"
title: "Smart Add Command Construction and Submission UX Fix"
status: "completed"
source: "smart-add"
startedAt: "2026-03-06T18:14:07.762Z"
completedAt: "2026-03-06T18:14:07.762Z"
acceptanceCriteria: []
description: "Two related regressions in the Rex Dashboard Smart Add form: (1) the CLI command is being built incorrectly, appending stale or unrelated text from the UI (e.g. a previous task title) to the `add` subcommand arguments, causing a command-not-found failure; (2) the form auto-submits on every keystroke or Enter press rather than waiting for the user to finish composing their input."
---

# Smart Add Command Construction and Submission UX Fix

 [completed]

## Summary

Two related regressions in the Rex Dashboard Smart Add form: (1) the CLI command is being built incorrectly, appending stale or unrelated text from the UI (e.g. a previous task title) to the `add` subcommand arguments, causing a command-not-found failure; (2) the form auto-submits on every keystroke or Enter press rather than waiting for the user to finish composing their input.

## Info

- **Status:** completed
- **Level:** task
- **Started:** 2026-03-06T18:14:07.762Z
- **Completed:** 2026-03-06T18:14:07.762Z
- **Duration:** < 1m
