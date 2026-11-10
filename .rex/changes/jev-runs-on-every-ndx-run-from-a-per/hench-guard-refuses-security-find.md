---
id: "8f7cb2f8-9389-46e7-a092-384e3ccbc31a"
type: "task"
title: "hench guard refuses security find-generic-password with options or escapes"
slug: "hench-guard-refuses-security-find"
description: "Should-fix from the #949 review. assertNotCredentialCommand in packages/hench/src/guard/commands.ts compares denied-prefix tokens positionally right after the program name. With security in guard.allowedCommands, `security -q find-generic-password -s X -w` (-q is a real global option) and `security find\\-generic-password …` (sh strips the backslash) pass both this check and validateCommand; both were run on macOS and executed find-generic-password. That defeats 'whatever guard.allowedCommands lists'. The Bash(security find-generic-password:*) deny rule in claude-cli-adapter.ts has the same gap. Fix: unescape words and skip options before matching the subcommand (or match it anywhere among the words), or refuse `security` outright while a keychain helper is configured, and add a matching Claude deny rule strategy. Helper prefixes matched by program name alone were fine."
acceptanceCriteria:
  - "With security in guard.allowedCommands, the guard refuses security -q find-generic-password … and security find\\-generic-password …"
  - "Other security subcommands the user allows still pass"
  - "The Claude CLI deny rules cover the same spellings, or the docs name the remaining gap"
priority: "high"
tags:
  - "credential-store"
  - "review-followup"
  - "hench"
  - "security"
source: "stack review of #942/#949/#952 (2026-11-03)"
---
