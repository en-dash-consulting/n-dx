---
id: "4dad9dc0-0538-44a6-879d-ac9749104622"
level: "task"
title: "MCP health on a v2 tree scores the change projection with v1 dimensions"
status: "pending"
priority: "medium"
tags:
  - "v2-hardening"
  - "rex"
source: "ndx-capture"
acceptanceCriteria:
  - "On a v2 tree, MCP health returns every field it returns today plus one added field carrying the v2 tree-rule results (and landing check) that CLI rex health shows, built by the same code (test)"
  - "No existing field of the MCP health response is removed or renamed (snapshot or shape test)"
  - "On a v1 tree the MCP health response is unchanged (existing tests pass unedited)"
  - "The added field has a changeset line fit for the release notes"
description: "Found 2026-10-14 (v2 migration-path page). MCP health (cli/mcp-tools/health.ts:9) runs computeHealthScore over store.loadDocument(), so on a v2 tree it scores the change projection with v1 dimensions (depth, balance, granularity, completeness, staleness). CLI `rex health` on a v2 tree (cli/commands/health.ts) reports the v2 tree rules (checkV2TreeHealth), reader warnings and landing check (checkChangeLandings) instead. An agent and a person see different health for the same tree.\n\nFix direction: on a v2 tree, MCP health keeps every field it returns today and adds one field carrying the v2 tree-rule results the CLI shows, built by the same code the CLI uses. On v1 the response is unchanged.\n\nOperator notes: MCP tool shapes are soft-frozen: add, never remove or rename. The new field needs a changeset line (patch, @n-dx/rex) fit for the release notes. Do not touch packages/rex/src/migrations/ or the rex migrate command. Run the six static root policy tests before finishing: tests/e2e/architecture-policy, domain-isolation, shell-spawn-inventory-policy, wall-clock-inventory-policy, layout-literal-policy and obfuscated-code-policy."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-15T05:55:50.474Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
