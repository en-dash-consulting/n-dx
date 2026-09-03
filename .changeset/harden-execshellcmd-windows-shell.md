---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
"@n-dx/rex": patch
---

Run shell commands in a shell that exists on Windows.

`execShellCmd` hardcoded `sh -c` on every platform. On Windows `sh` ships with
Git for Windows and is on PATH only inside Git Bash, so from PowerShell or
cmd.exe — the default shells — the spawn failed with ENOENT. `exec` reported
that as `exitCode: 1` with empty output, which is indistinguishable from a
command that ran and failed: hench's test gate concluded the suite was broken
after essentially every task, and `rex verify` reported `passed: false` for
tests that never started.

`execShellCmd` now resolves the shell per platform — `sh -c` wherever a POSIX
shell is resolvable, `cmd.exe /d /s /c` on a Windows box without one. POSIX
behaviour is unchanged, and Windows machines that have Git for Windows keep
POSIX semantics rather than being switched to cmd.exe.

`ExecResult` gains `launched`, which is `false` when the command never started.
Callers that infer pass/fail from `exitCode` alone can no longer mistake an
unlaunchable command for a failing one; `rex verify` and hench's `run_command`
now report the two cases differently.

The two remaining sites that spawned `sh` directly (hench's `execShell`, rex's
`verify`) are routed through `execShellCmd`, and an architecture-policy guard
fails the build if a new one appears.
