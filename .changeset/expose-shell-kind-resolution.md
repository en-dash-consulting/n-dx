---
"@n-dx/llm-client": patch
---

Export `hasPosixShell` and `resolveShellKind` from `@n-dx/llm-client`. `resolveShellKind` is now the single source of the sh-vs-cmd.exe decision — `buildShellInvocation` derives its `kind` from it — so a caller that validates a command string before `execShellCmd` runs it (hench's command guard) asks the same question the same way.
