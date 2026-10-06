---
id: "d0698e32-747d-4934-b2f8-4e698b4feef1"
level: "feature"
title: "Split the rex MCP tools into one module per tool"
status: "pending"
priority: "medium"
tags:
  - "product-map"
  - "pr-02"
  - "lane-rex-surface"
  - "rex"
source: "roadmap"
acceptanceCriteria: []
description: "rex/src/cli/mcp-tools.ts is 1,072 lines holding every tool, so every MCP change in the roadmap would conflict on it. Split it before any of them start. Behaviour-neutral.\n\nRoadmap PR 2 · wave 0 · lane rex-surface."
lastModified: "2026-10-06T04:16:37.159Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Move each rex MCP tool handler into its own module behind a registry](./move-each-rex-mcp-tool-handler-into.md) | completed |
| [Rex MCP tool access kinds are unpinned, so a write tool can flip to read and escape #499 write refusal](./rex-mcp-tool-access-kinds-are-unpinned.md) | pending |
