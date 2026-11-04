---
id: "534debf3-0b82-43af-adf5-be497be7b85f"
type: "task"
title: "C4: helper backend runs a password-manager command for a stored credential"
slug: "c4-helper-backend-runs-a-password"
description: "PR 2, second task (after T7). A helper entry holds an argv array for a password-manager command (op, pass, bw, gopass) and resolveCredential runs it. resolveCredential is synchronous and PR 1's callers (resolveJudgmentRoute, askJev, hench deny rules) rely on that, so the helper runs with execFileSync, no shell, closed stdin and a 10 s timeout, cached per process. setCredential spreads the old entry to keep unknown fields, so switching backends must drop the other backend's own field. --helper \"<cmd>\" is parsed with shell-style quoting and no expansion, refusing | ; & > < $( backticks and a leading -; no shell is ever run. hench's command guard is an allowlist (guard.allowedCommands), so the denylist matters when a user widens it and for the Claude CLI's --disallowed-tools. Never print a value, a helper's stdout or its stderr."
acceptanceCriteria:
  - "Helper entries are {backend: helper, argv: string[] (non-empty), updatedAt}; setHelperCredential(name, argv) writes one and is exported from public.ts; switching an entry between file and helper drops the other backend's value/argv and keeps unknown fields (unit test)"
  - "resolveCredential runs a helper via execFileSync(argv[0], argv.slice(1)) with no shell, closed stdin and a 10 s timeout; trimmed stdout is the value, cached per process by name and argv; empty or multi-line stdout is a failure; the env var still wins over a helper (unit tests)"
  - "A failed, timed-out or missing helper makes resolveCredential return undefined and warns once per process naming the entry, argv[0] and the exit code or timeout, never stdout or stderr (unit test with a fake helper that prints a placeholder)"
  - "credentialStatus reports backend helper and argv[0] without running it; ndx config credentials shows helper (<argv0>) and runs the helper only with --check (e2e)"
  - "ndx config credentials.<name> --helper \"<cmd>\" parses with shell-style quoting and no expansion, refuses | ; & > < $( backticks and a leading - as a usage error, and stores the entry through dist/cli/credentials.js set-helper <name> with argv as JSON on stdin (e2e with a temp home and a fake helper)"
  - "hench's command guard refuses security find-generic-password and every configured helper's argv[0] even when guard.allowedCommands lists them (unit test); Claude CLI runs add Bash(security find-generic-password:*) and Bash(<argv0>:*) to --disallowed-tools beside the T5 store rules (argv tests, POSIX and win32)"
  - "A code comment and the PR body state that an allowed interpreter such as node -e can still read the store or run the helper"
priority: "medium"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "credential-injection-design"
blockedBy:
  - "2f5ce643-1c49-4c70-ab2c-545f956873df"
  - "94e25654-bb3c-4203-a1ab-49267e0ad734"
---
