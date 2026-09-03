---
id: "72422229-4ca2-476d-9fa9-95ff8b6f8362"
level: "task"
title: "Harden execShellCmd for Windows — `sh -c` is unresolvable outside Git Bash"
status: "pending"
priority: "critical"
tags:
  - "windows"
  - "reliability"
  - "llm-client"
  - "cross-os"
  - "exec"
source: "ndx-capture"
acceptanceCriteria:
  - "execShellCmd executes a shell command successfully on Windows when launched from PowerShell and from cmd.exe, with no Git Bash on PATH"
  - "A command that cannot be executed at all is distinguishable by callers from one that ran and exited non-zero"
  - "POSIX behavior is unchanged — existing `sh -c` semantics (pipes, globs, `&&`) still hold"
  - "Regression test pins the PowerShell-launch case, skipped on non-win32"
  - "No remaining `sh -c` spawn site bypasses the hardened path"
description: "`execShellCmd` (`packages/llm-client/src/exec.ts:396`) hardcodes `exec(\"sh\", [\"-c\", command])`. On Windows, `sh` resolves only when Git Bash's `usr/bin` is on PATH — it is not under PowerShell or cmd.exe, the default shells. Verified on this machine: `Get-Command sh` from PowerShell returns nothing, while the same `sh -c \"npm run test\"` runs fine under Git Bash. Every caller then gets a silent ENOENT that `exec`'s error handler (`exec.ts:254`) flattens to `exitCode: 1` with empty stdout/stderr — indistinguishable from a real non-zero exit. Affects the hench test gate (`hench/src/tools/test-runner.ts:586`), `hench/src/tools/exec-shell.ts:65`, `rex/src/core/verify.ts:287`, and the dependency-audit paths at `test-runner.ts:799`/`:834`. `spawnCli` in the same file is already Windows-aware via a `cmd.exe` verbatim command line — apply the same treatment. This is a remaining unhardened shell-string spawn site that the sibling sweep task missed because it hardened arg-vector spawns, not shell strings."
lastModified: "2026-09-03T14:01:55.435Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
