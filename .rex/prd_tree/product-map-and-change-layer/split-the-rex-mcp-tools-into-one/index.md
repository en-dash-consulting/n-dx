---
id: "d0698e32-747d-4934-b2f8-4e698b4feef1"
level: "feature"
title: "Split the rex MCP tools into one module per tool"
status: "completed"
priority: "medium"
tags:
  - "product-map"
  - "pr-02"
  - "lane-rex-surface"
  - "rex"
source: "roadmap"
startedAt: "2026-10-06T22:54:48.206Z"
completedAt: "2026-10-06T22:54:48.206Z"
endedAt: "2026-10-06T22:54:48.206Z"
acceptanceCriteria: []
description: "rex/src/cli/mcp-tools.ts is 1,072 lines holding every tool, so every MCP change in the roadmap would conflict on it. Split it before any of them start. Behaviour-neutral.\n\nRoadmap PR 2 · wave 0 · lane rex-surface."
lastModified: "2026-10-06T22:54:48.641Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Move each rex MCP tool handler into its own module behind a registry](./move-each-rex-mcp-tool-handler-into.md) | completed |
