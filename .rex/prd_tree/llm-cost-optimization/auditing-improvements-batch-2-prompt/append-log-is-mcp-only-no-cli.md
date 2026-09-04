---
id: "db878e62-90a2-49cc-a0e4-795ff474177b"
level: "task"
title: "append_log is MCP-only — no CLI equivalent, so ndx work runs cannot write execution-log entries"
status: "pending"
priority: "medium"
acceptanceCriteria: []
description: "All three ndx work runs in this batch reported the same gap: the workflow asks the agent to append a structured entry to .rex/execution-log.jsonl, but append_log is exposed only as a rex MCP tool and there is no 'rex log' CLI command. When the rex MCP server is not connected to the agent's session - which it was not for any of these runs - the step is impossible, and rex owns the file under the write-access protocol so hand-writing it is forbidden. Each run put the detail in its commit message instead. Add a CLI surface (rex log / ndx log) so the execution log is reachable without MCP, or drop the step from the workflow when MCP is absent. Not yet implemented."
lastModified: "2026-09-04T22:21:38.744Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
