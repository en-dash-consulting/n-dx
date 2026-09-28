---
id: "db878e62-90a2-49cc-a0e4-795ff474177b"
level: "task"
title: "append_log is MCP-only — no CLI equivalent, so ndx work runs cannot write execution-log entries"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "rex-log-budget-tuners"
  - "pr-17"
acceptanceCriteria:
  - "`rex log` and MCP append_log write through one shared writer (the entry builder behind handleAppendLog feeding PRDStore.appendLog). A rex test runs both paths against a temp .rex/ and asserts identical entries apart from timestamp and actor, detail cut at 2,000 characters, and rotation to execution-log.1.jsonl once the log passes 1 MB."
  - "`ndx log` in packages/core spawns the rex CLI and does not import rex, so tests/e2e/architecture-policy.test.js passes with the new command; a core test asserts `ndx log` forwards its arguments and appends an entry."
  - "An agent without the rex MCP server can write the log. A hench test asserts that the Codex-adapter run's workflow text names the CLI log command, and the rex default workflow step and the ndx-work skill name `ndx log` as the route when MCP is absent."
  - "`rex log --help` and `ndx log --help` name the event, item and detail arguments and say the command is the non-MCP route to append_log; a test asserts both help texts."
description: "All three ndx work runs in this batch reported the same gap: the workflow asks the agent to append a structured entry to .rex/execution-log.jsonl, but append_log is exposed only as a rex MCP tool and there is no 'rex log' CLI command. When the rex MCP server is not connected to the agent's session - which it was not for any of these runs - the step is impossible, and rex owns the file under the write-access protocol so hand-writing it is forbidden. Each run put the detail in its commit message instead. Add a CLI surface (rex log / ndx log) so the execution log is reachable without MCP, or drop the step from the workflow when MCP is absent. Not yet implemented."
lastModified: "2026-09-28T19:01:09.772Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
