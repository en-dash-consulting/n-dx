---
id: "2238b4b2-49a4-483d-885a-34da3e9b5389"
level: "task"
title: "Detect project CLI name from package.json bin field and expose in .n-dx.json schema"
status: "completed"
priority: "critical"
tags:
  - "cli"
  - "config"
  - "identity"
source: "smart-add"
startedAt: "2026-08-12T13:52:05.159Z"
completedAt: "2026-08-12T17:02:44.976Z"
endedAt: "2026-08-12T17:02:44.976Z"
acceptanceCriteria:
  - "Resolver reads the first binary name from package.json bin field at the project root"
  - "Resolved name is written as cli.name in .n-dx.json when ndx init runs"
  - "ndx config cli.name can be read and written to manually override the detected value"
  - "When package.json has no bin field, cli.name defaults to 'ndx'"
  - "Resolver is a pure exported function with unit tests covering: bin-object, bin-string, missing bin, and manual override cases"
description: "Implement a CLI name resolver that reads the target project's package.json bin field to determine the installed command name (e.g. 'ndx', 'myapp', or a custom alias). Expose cli.name as a configurable field in the .n-dx.json schema with auto-detection as the default. Wire the resolver into ndx init and ndx config so the value is populated on first run and can be overridden manually."
---
