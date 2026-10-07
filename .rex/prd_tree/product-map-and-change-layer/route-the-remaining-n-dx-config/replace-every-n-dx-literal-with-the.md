---
id: "66397a69-5347-4659-8852-4ff1724ae261"
level: "task"
title: "Replace every .n-dx* literal with the resolved config path"
status: "pending"
priority: "high"
tags:
  - "pr-29"
  - "lane-models-analysis"
source: "roadmap"
acceptanceCriteria:
  - "The inventory lists zero .n-dx* literals"
  - "For each package that reads project config, a test proves a value in .ndx/config.json is honoured on the .ndx/ layout"
  - "The legacy layout still reads .n-dx.json (existing tests pass)"
description: "Work through tests/layout-literal-inventory.md: replace each .n-dx.json, .n-dx.local.json, .n-dx-web.pid, .n-dx-web.port and .n-dx-web-usage.jsonl literal with the resolver's path (resolveLayout(...).configFile and siblings, through each package's paths module or gateway; the orchestration tier uses packages/core/layout.js). Delete each inventory row as it is cleared. Add a test per package that a config value set in .ndx/config.json is honoured on the .ndx/ layout."
lastModified: "2026-10-06T23:38:08.201Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
