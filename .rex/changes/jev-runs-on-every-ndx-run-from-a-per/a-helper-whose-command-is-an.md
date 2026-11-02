---
id: "9dd5658d-a708-473b-acb0-63c8df1cc127"
type: "task"
title: "A helper whose command is an interpreter (node, python3, bash) denies that interpreter to every agent run"
slug: "a-helper-whose-command-is-an"
description: "PR 2, runs after C4 (534debf3) and before C2b. Two follow-ups to C4's helper backend in packages/llm-client/src/credential-store.ts. (1) Found by C4's review (medium, should-fix): agentCredentialDenials turns a helper's argv[0] into deny prefixes, so a helper such as --helper \"node /Users/me/bin/get-key.mjs\" makes hench's guard (packages/hench/src/guard/commands.ts) refuse every node command and Claude CLI runs get Bash(node:*) in --disallowed-tools, silently, in every later ndx work run. For a known interpreter (node, python, python3, bash, sh, zsh, pwsh, powershell, ruby, perl, deno, bun, matched on the basename without .exe/.cmd) deny the argv up to and including its first non-option argument (the script), not the bare interpreter. An interpreter helper with no script argument (bash -c \"...\", node -e \"...\") is effectively a shell and is refused at --helper time. (2) runHelper caches a failed result for the life of the process, so a long-running hub or MCP server never retries after the user unlocks their password manager. A success stays cached per process; a failure is retried after a short window. Never print a value or a helper's output."
acceptanceCriteria:
  - "A helper stored as [\"node\", \"/x/get-key.mjs\"] yields the deny prefix [\"node\", \"/x/get-key.mjs\"], not [\"node\"], and [\"node\", \"--no-warnings\", \"/x/get-key.mjs\"] yields that whole prefix; a non-interpreter helper such as op keeps its argv[0] prefixes as today (unit tests on agentCredentialDenials)"
  - "With that helper stored, hench's guard still allows node -e 1 and refuses node /x/get-key.mjs (unit test)"
  - "Claude CLI --disallowed-tools carries Bash(node /x/get-key.mjs:*) and no bare Bash(node:*) (argv tests, POSIX and win32)"
  - "ndx config credentials.<name> --helper refuses an interpreter with no script argument (bash -c ..., node -e ..., python3 -c ...) as a usage error, and for an interpreter helper with a script prints one line saying the agent can still run the interpreter itself (e2e)"
  - "A failed, timed-out or missing helper is retried after 60 s, so a long-running process picks the key up once the password manager is unlocked; a success stays cached for the process; the warning is printed once per failure streak, not on every retry (unit tests with an injected clock)"
priority: "medium"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "security"
source: "ndx-adversarial-review"
blockedBy:
  - "534debf3-0b82-43af-adf5-be497be7b85f"
---
