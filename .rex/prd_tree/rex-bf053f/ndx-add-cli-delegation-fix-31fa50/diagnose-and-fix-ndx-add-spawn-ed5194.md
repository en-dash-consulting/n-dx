---
id: "ed519429-b3c8-4b93-bf6c-ef9b3233fd06"
level: "task"
title: "Diagnose and fix ndx add spawn delegation in cli.js"
status: "completed"
priority: "critical"
tags:
  - "cli"
  - "bugfix"
  - "orchestration"
source: "smart-add"
startedAt: "2026-03-19T18:17:38.180Z"
completedAt: "2026-03-19T18:23:25.880Z"
resolutionType: "code-change"
resolutionDetail: "Fixed handleAdd in cli.js to use process.cwd() instead of resolveDir(rest) for the requireInit check. The add command's positional args are descriptions, not directory paths, so resolveDir was misinterpreting them. Rex's dispatchAdd already handles dir resolution internally via resolveSmartAddArgs."
acceptanceCriteria:
  - "`ndx add \"some description\"` completes without a missing-.rex error when run from a directory containing `.rex/`"
  - "All flags supported by `rex add` (`--file`, `--accept`, `--parent`, `--manual`) are forwarded correctly through `ndx add`"
  - "Running `ndx add` outside an initialized directory surfaces the same user-friendly error as `rex add`, not a raw stack trace"
  - "Exit code from `rex add` is propagated through `ndx add` unchanged"
description: "Audit the `ndx add` handler in `cli.js` to identify why it raises a missing-.rex error rather than delegating to `rex add`. The most likely causes are: (1) the spawn call passes the wrong working directory, (2) arguments are not forwarded correctly, or (3) the rex binary path resolution fails before the spawn. Fix the root cause so `ndx add <description>` and all its flags (`--file`, `--accept`, etc.) behave identically to `rex add`."
---
