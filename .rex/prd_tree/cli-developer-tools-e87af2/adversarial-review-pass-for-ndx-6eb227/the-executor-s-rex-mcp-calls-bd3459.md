---
id: "bd3459fc-fa86-423d-a2f1-e72f7f73fe78"
level: "task"
title: "The executor's rex MCP calls also depend on the analyzed project's settings.json"
status: "pending"
priority: "high"
tags:
  - "e2e-finding"
  - "permissions"
  - "severity:high"
source: "ndx-capture"
acceptanceCriteria:
  - "Established which of the executor's PRD writes go through MCP versus the in-process rex-gateway store"
  - "A hench run in a project with no rex entries in .claude/settings.json completes and records status without permission denials"
  - "The executor's granted MCP surface is decided explicitly and documented, not inherited from whatever the project allows"
  - "A denied MCP write during a run surfaces as an explicit warning rather than a silent no-op"
description: "Found while fixing the reviewer's capture denial (120b14f2), and deliberately left out of that change so the executor's write surface is decided on its own merits rather than widened as a side effect.\n\nbuildAllowedTools (claude-cli-adapter.ts) derives grants from the execution policy, which describes shell and file access only — it names no MCP tool. So every MCP permission for a spawned session comes from the ANALYZED PROJECT's .claude/settings.json, which hench neither owns nor can assume exists.\n\nIn the n-dx repo this is invisible: .claude/settings.json happens to enumerate mcp__rex__update_task_status and mcp__rex__append_log, which is exactly why the executor's status update and log write succeeded on run 60c3a951 while the reviewer's add_item was denied. The executor is not more privileged by design — it is more privileged by coincidence of this one repo's settings file.\n\nIn a project with no rex entries in settings.json — the normal case for anyone using n-dx on their own codebase — the executor's update_task_status and append_log would be denied the same way. The task would do its work and then fail to record completion, or record it only via the CLI-side status update if one happens later. Worth establishing which of hench's PRD writes actually flow through MCP versus the in-process rex-gateway store, because only the MCP ones are exposed to this.\n\nThe reviewer's fix added an explicit extraAllowedTools grant at spawn time (REX_CAPTURE_TOOLS). The same mechanism is available here; what needs deciding is scope. An implementing agent arguably needs update_task_status and append_log, but granting add_item/edit_item/move_item would let it restructure the PRD mid-task, which is a different proposition."
lastModified: "2026-08-27T18:01:08.869Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
