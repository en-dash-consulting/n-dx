---
id: "9dd5658d-a708-473b-acb0-63c8df1cc127"
type: "task"
title: "A helper whose command is an interpreter (node, python3, bash) denies that interpreter to every agent run"
slug: "a-helper-whose-command-is-an"
description: "Adversarial review of C4 (534debf3), finding (medium, should-fix).\n\nFailure scenario: a user stores `ndx config credentials.typesafe --helper \"node /Users/me/bin/get-key.mjs\"` (or `python3 …`, `bash …`, `sh -c`-free scripts). agentCredentialDenials (packages/llm-client/src/credential-store.ts, agentCredentialDenials) turns argv[0] into the deny prefixes [node], [node.exe]. From then on hench's guard (packages/hench/src/guard/commands.ts assertNotCredentialCommand) refuses every `node …` run_command, and Claude CLI runs get `Bash(node:*)` in --disallowed-tools (claude-cli-adapter.ts buildDisallowedTools). The agent can no longer run `node` for anything, including tests and scripts, and the refusal message says it \"reads a stored credential\", which is confusing. The breakage appears silently in every later `ndx work` run, with nothing tying it to the helper.\n\nReachable: `ndx config credentials.<name> --helper \"<interpreter> <script>\"` followed by any `ndx work` run on the Claude CLI or through hench's guard.\n\nOptions:\n(a) When argv[0] is a known interpreter (node, python, python3, bash, sh, zsh, pwsh, powershell, ruby, perl, deno, bun), deny the prefix [argv0, argv1], meaning the interpreter plus the script path, instead of the bare interpreter. Cheap. The guard and the Bash rule already support multi-token prefixes.\n(b) Refuse an interpreter argv[0] at set-helper time and ask for an executable script. Simple, but rejects a reasonable setup.\nRecommendation: (a), plus a warning at `--helper` time that the agent stays able to run the interpreter itself (the documented interpreter gap)."
acceptanceCriteria:
  - "A helper stored as [\"node\", \"/x/get-key.mjs\"] yields the deny prefix [\"node\", \"/x/get-key.mjs\"], not [\"node\"] (unit test on agentCredentialDenials)"
  - "With that helper stored, hench's guard still allows `node -e 1` and refuses `node /x/get-key.mjs` (unit test)"
  - "Claude CLI --disallowed-tools carries Bash(node /x/get-key.mjs:*) and no bare Bash(node:*) (argv test, POSIX and win32)"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "security"
source: "ndx-adversarial-review"
---
