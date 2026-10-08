---
id: "66397a69-5347-4659-8852-4ff1724ae261"
level: "task"
title: "Replace every .n-dx* literal with the resolved config path"
status: "completed"
priority: "high"
tags:
  - "pr-29"
  - "lane-models-analysis"
source: "roadmap"
startedAt: "2026-10-08T02:38:48.300Z"
completedAt: "2026-10-08T02:38:48.300Z"
endedAt: "2026-10-08T02:38:48.300Z"
resolutionType: "code-change"
resolutionDetail: "All 29 .n-dx* literals in 22 files routed through resolveLayout (llm-client config loaders, hench cli-name/quota/archival/retention/test-command, web routes + dashboard usage ledger + CLI Timeouts page via configFile in GET /api/cli/timeouts). Inventory at zero. Also fixed dirname(stateDir) project-root recovery on .ndx/ via projectRootOf (llm-client, hench gateway, rex adapters). Per-package .ndx/config.json tests added. Branch feat/pr29-ndx-config-literals."
acceptanceCriteria:
  - "The inventory lists zero .n-dx* literals"
  - "For each package that reads project config, a test proves a value in .ndx/config.json is honoured on the .ndx/ layout"
  - "The legacy layout still reads .n-dx.json (existing tests pass)"
description: "Work through tests/layout-literal-inventory.md: replace each .n-dx.json, .n-dx.local.json, .n-dx-web.pid, .n-dx-web.port and .n-dx-web-usage.jsonl literal with the resolver's path (resolveLayout(...).configFile and siblings, through each package's paths module or gateway; the orchestration tier uses packages/core/layout.js). Delete each inventory row as it is cleared. Add a test per package that a config value set in .ndx/config.json is honoured on the .ndx/ layout."
lastModified: "2026-10-08T02:38:48.806Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
