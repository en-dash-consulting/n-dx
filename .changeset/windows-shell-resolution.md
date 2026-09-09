---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
"@n-dx/rex": patch
---

Run shell commands through a shell the host actually has, and never report a
gate failure with no reason.

`execShellCmd` spawned `sh` on every platform. `sh` is not a Windows program:
Git for Windows ships `sh.exe` in `Git\bin` while putting only `Git\cmd`
(git.exe alone) on PATH, so the spawn failed with ENOENT about 2 ms in. A failed
spawn surfaces as `exitCode: 1` with empty stdout and stderr, which every caller
read as a command that ran and failed — so on a stock Windows shell the hench
full-suite test gate aborted otherwise-good `ndx work` runs, printing
`✗ 0/0 package(s) failed` and `Test gate failed:` with an empty package list.
`resolveShellInvocation` now prefers `sh` wherever `sh` is on PATH (Git Bash
sessions keep POSIX command syntax) and otherwise uses `cmd.exe /d /s /c` with
the command quoted verbatim, so quotes inside it survive. hench's `run_command`
/ `git` tools and `rex verify --run-tests` go through the same resolution.

The gate's reporting no longer depends on the output being parseable: a non-zero
exit that names no package now gets a synthetic `workspace` entry carrying the
exit code, a PATH hint when the launch itself failed, and whatever the command
printed — and the run record says that instead of `Test gate failed: `.
