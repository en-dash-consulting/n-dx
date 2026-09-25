---
id: "6af0a1c8-3df5-4348-8ae3-1056b6a1e965"
level: "feature"
title: "A finished run lands its work in consumer projects"
status: "pending"
priority: "critical"
tags:
  - "0.7.2"
  - "hench"
  - "run-lifecycle"
source: "ndx-capture"
acceptanceCriteria: []
description: "Two defects seen in consumer project caos (runs e3fe956f and 2fb96507) that make a run whose work passed every check end failed, with its work uncommitted or its completion recorded outside hench's hold. First, the spawned Claude session cannot call the rex MCP write tools hench itself attaches. Second, the completion gate excludes review repairs even when nothing will commit them, so its refusal leaves out the agent's actual work."
lastModified: "2026-09-25T19:14:21.092Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Allow hench's own rex MCP write tools in the spawned Claude session](./allow-hench-s-own-rex-mcp-write-tools.md) | completed |
| [Count review repairs as uncommitted work unless a commit will really follow](./count-review-repairs-as-uncommitted.md) | pending |
