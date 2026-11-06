---
id: "f4a77d97-b2a2-4009-8784-3a3a779884f2"
type: "task"
title: "The command guard refuses brace and glob spellings of a denied credential command"
slug: "the-command-guard-refuses-brace-and"
description: "#956 review S4. packages/hench/src/guard/commands.ts commandWords (:200) handles quote removal and backslashes but not the expansions sh runs afterwards; on macOS /bin/sh is bash and run_command goes through it. With security in guard.allowedCommands: 'security {find-generic-password,-s} ndx -w' passes, because the guard sees the word '{find-generic-password,-s}' and '{' ',' '}' are not in ACTIVE_SHELL_OPERATORS (verified: sh -c 'echo security {find-generic-password,-s} ndx -w' prints the expanded command on macOS 14). Globs too: write an empty file named find-generic-password, then 'security fin[d]-generic-password -w' or 'security find-generic-passwor? -w'. The macOS sandbox denies keychain reads by default, so this matters when the sandbox is off or unsupported. Fix: commandWords records per word whether an unquoted { * ? [ appeared; once the program is a denied one (the Keychain read or a helper's command), any later word with such a character is refused."
acceptanceCriteria:
  - "'security {find-generic-password,-s} ndx -w', 'security fin[d]-generic-password -w' and 'security find-generic-passwor? -w' are refused with security in guard.allowedCommands (unit test)"
  - "The same characters inside quotes, and in commands that are not denied (e.g. 'ls *.ts', 'echo {a,b}'), still pass (unit test)"
  - "A configured helper's command spelled with a brace or glob in a later word is refused the same way (unit test)"
priority: "medium"
source: "pr-956-review"
---
