---
id: "66397a69-5347-4659-8852-4ff1724ae261"
type: "change"
title: "Replace every .n-dx* literal with the resolved config path"
slug: "replace-every-n-dx-literal-with-the"
intent: "Work through tests/layout-literal-inventory.md: replace each .n-dx.json, .n-dx.local.json, .n-dx-web.pid, .n-dx-web.port and .n-dx-web-usage.jsonl literal with the resolver's path (resolveLayout(...).configFile and siblings, through each package's paths module or gateway; the orchestration tier uses packages/core/layout.js). Delete each inventory row as it is cleared. Add a test per package that a config value set in .ndx/config.json is honoured on the .ndx/ layout."
acceptanceCriteria:
  - "The inventory lists zero .n-dx* literals"
  - "For each package that reads project config, a test proves a value in .ndx/config.json is honoured on the .ndx/ layout"
  - "The legacy layout still reads .n-dx.json (existing tests pass)"
amends: [{"target":"a7c0061e-eb80-473b-84b2-861194fbcc47","delta":"modified","summary":"Replace every .n-dx* literal with the resolved config path","base":"081c3d79f4288bf9c102522faa416df7eb3cf164f912fd2485625197b77f69ae"}]
priority: "high"
tags:
  - "pr-29"
  - "lane-models-analysis"
source: "roadmap"
---
