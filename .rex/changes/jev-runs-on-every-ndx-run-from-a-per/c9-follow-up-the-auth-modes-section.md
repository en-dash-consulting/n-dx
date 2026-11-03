---
id: "dbc9c046-3fcc-43bc-a290-87d7ab5f4565"
type: "task"
title: "C9 follow-up: the auth modes section overstates what agents are denied"
slug: "c9-follow-up-the-auth-modes-section"
description: "docs/guide/configuration.md, the 'API keys and auth modes' section C9 added (2a108c3f3, 0013d521b), says two things the code does not do. (1) The --helper paragraph says 'an interpreter helper needs a script path, and agent runs are denied that interpreter'. Since 9dd5658d (0a80079ab), agents are denied the interpreter's script (the argv up to the script, e.g. node /x/get-key.mjs), and the interpreter itself stays allowed; set-helper prints a note saying so. (2) The last paragraph says 'Agent runs cannot read the store: the Claude CLI gets deny rules for it and hench's guard blocks it.' The documented gaps are that an allowed interpreter such as node -e can still read the store or run a helper, and the Codex CLI sandbox has no path deny rule, until OS keystore backends (C10). Docs only; never print a value."
acceptanceCriteria:
  - "The --helper paragraph says agents are denied the helper's script and may still run the interpreter itself"
  - "The store paragraph says what agents are denied (the Claude CLI deny rules, hench's guard, the helper commands) and names both gaps: an allowed interpreter such as node -e, and the Codex CLI"
  - "No other page changes, and the docs tests and tests/e2e/agents-md-size-budget.test.js pass"
priority: "medium"
source: "credential-injection-design"
---
