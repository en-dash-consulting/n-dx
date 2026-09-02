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

## Children

| Title | Status |
|-------|--------|
| [Add regression tests asserting no JSON writes occur outside ndx start](./add-regression-tests-asserting-67246c.md) | completed |
| [Audit and remove residual JSON write calls from rex CLI and MCP handlers](./audit-and-remove-residual-json-eb208a.md) | completed |
| [Remove JSON dual-write from PRDStore save operations](./remove-json-dual-write-from-72581f.md) | completed |
