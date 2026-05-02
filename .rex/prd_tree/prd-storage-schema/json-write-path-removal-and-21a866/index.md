---
id: "21a86676-166a-4af7-bc57-39af1f47d2ba"
level: "feature"
title: "JSON Write Path Removal and Markdown-Only Enforcement"
status: "completed"
source: "smart-add"
startedAt: "2026-04-29T03:45:50.036Z"
completedAt: "2026-04-29T03:45:50.036Z"
endedAt: "2026-04-29T03:45:50.036Z"
acceptanceCriteria: []
description: "Remove all code that writes to .rex/prd.json (and any branch-scoped .rex/prd_*.json files) from PRD mutation paths. After the dual-write migration phase, only Markdown files should be written by ndx add, rex CLI commands, and MCP write tools. The only permitted JSON write is the ephemeral .rex/.cache/prd.json produced by ndx start."
---

# JSON Write Path Removal and Markdown-Only Enforcement

 [completed]

## Summary

Remove all code that writes to .rex/prd.json (and any branch-scoped .rex/prd_*.json files) from PRD mutation paths. After the dual-write migration phase, only Markdown files should be written by ndx add, rex CLI commands, and MCP write tools. The only permitted JSON write is the ephemeral .rex/.cache/prd.json produced by ndx start.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Add regression tests asserting no JSON writes occur outside ndx start | task | completed | 2026-04-29 |
| Audit and remove residual JSON write calls from rex CLI and MCP handlers | task | completed | 2026-04-29 |
| Remove JSON dual-write from PRDStore save operations | task | completed | 2026-04-29 |

## Info

- **Status:** completed
- **Level:** feature
- **Started:** 2026-04-29T03:45:50.036Z
- **Completed:** 2026-04-29T03:45:50.036Z
- **Duration:** < 1m
