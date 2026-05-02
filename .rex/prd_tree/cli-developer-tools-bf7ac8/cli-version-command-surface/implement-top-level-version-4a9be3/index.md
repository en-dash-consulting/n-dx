---
id: "4a9be3cc-25d6-4429-ae79-304f10d097fb"
level: "task"
title: "Implement top-level version flag handling for ndx and n-dx"
status: "completed"
priority: "high"
tags:
  - "cli"
  - "ux"
source: "smart-add"
startedAt: "2026-04-06T18:47:31.857Z"
completedAt: "2026-04-06T18:50:16.350Z"
acceptanceCriteria:
  - "Running `ndx -v` prints a single version string and exits with status code 0"
  - "Running `ndx --version` prints the same version output as `ndx -v`"
  - "Running `n-dx -v` and `n-dx --version` behave identically to `ndx` version flags"
  - "Version flag handling works from the top-level CLI without requiring a subcommand"
  - "Invoking the version flags does not start long-running services or execute unrelated command logic"
description: "Add argument handling in the shared CLI entrypoint so invoking `ndx -v`, `ndx --version`, `n-dx -v`, or `n-dx --version` prints the current package version and exits successfully without triggering normal command parsing."
---

# Implement top-level version flag handling for ndx and n-dx

🟠 [completed]

## Summary

Add argument handling in the shared CLI entrypoint so invoking `ndx -v`, `ndx --version`, `n-dx -v`, or `n-dx --version` prints the current package version and exits successfully without triggering normal command parsing.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** cli, ux
- **Level:** task
- **Started:** 2026-04-06T18:47:31.857Z
- **Completed:** 2026-04-06T18:50:16.350Z
- **Duration:** 2m
