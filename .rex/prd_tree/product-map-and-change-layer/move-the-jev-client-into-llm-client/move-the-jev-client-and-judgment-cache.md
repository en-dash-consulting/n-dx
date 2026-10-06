---
id: "078d06e8-aef0-4061-8e6a-074950d56b38"
level: "task"
title: "Move the Jev client and judgment cache from sourcevision into llm-client"
status: "in_progress"
priority: "medium"
tags:
  - "pr-04"
  - "lane-models-analysis"
  - "llm-client"
  - "sourcevision"
source: "roadmap"
startedAt: "2026-10-06T07:44:22.830Z"
acceptanceCriteria:
  - "sourcevision's Jev behaviour and judgment cache are unchanged (existing tests pass)"
  - "llm-client exports the Jev client and judgment cache"
  - "domain-isolation.test.js passes with the new import direction"
description: "Move sourcevision/src/analyzers/jev-client.ts and judgment-cache.ts into llm-client, export them from its public API, and import them in sourcevision from there. Keep the cache file location and format unchanged."
lastModified: "2026-10-06T07:44:23.258Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
