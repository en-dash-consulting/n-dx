---
id: "4dad9dc0-0538-44a6-879d-ac9749104622"
type: "change"
title: "MCP health on a v2 tree scores the change projection with v1 dimensions"
slug: "mcp-health-on-a-v2-tree-scores-the"
intent: "Found 2026-10-14 (v2 migration-path page). MCP health (cli/mcp-tools/health.ts:9) runs computeHealthScore over store.loadDocument(), so on a v2 tree it scores the change projection with v1 dimensions (depth, balance, granularity, completeness, staleness). CLI `rex health` on a v2 tree (cli/commands/health.ts) reports the v2 tree rules (checkV2TreeHealth), reader warnings and landing check (checkChangeLandings) instead. An agent and a person see different health for the same tree.\n\nFix direction: on a v2 tree, MCP health keeps every field it returns today and adds one field carrying the v2 tree-rule results the CLI shows, built by the same code the CLI uses. On v1 the response is unchanged.\n\nOperator notes: MCP tool shapes are soft-frozen: add, never remove or rename. The new field needs a changeset line (patch, @n-dx/rex) fit for the release notes. Do not touch packages/rex/src/migrations/ or the rex migrate command. Run the six static root policy tests before finishing: tests/e2e/architecture-policy, domain-isolation, shell-spawn-inventory-policy, wall-clock-inventory-policy, layout-literal-policy and obfuscated-code-policy.\n\nAttempt 1 (run e40599b9, 2026-10-14) committed 42eff0296. Its gate failed on one test: packages/rex/tests/unit/schema/v2.test.ts 'isolation > no runtime module imports the v2 modules yet', because the new cli/v2-health.ts and cli/mcp-tools/health.ts import the v2 modules (prd-model-reader / schema/v2) and are not on that test's allowlist. That test file is owned by another session (the stack 2 restack) and must NOT be edited. Attempt 2: keep the behaviour, but put the shared report builder in a module already on the allowlist (cli/commands/health.ts or core/health.ts), delete cli/v2-health.ts, and have cli/mcp-tools/health.ts reach it without importing schema/v2, state-writer or prd-model-* itself: detect the layout with isChangeLayerStore from ../../store/index.js, as update-task-status.ts does. Then run the rex suite (including tests/unit/schema/v2.test.ts), the gate's affected suites and the six root policy tests."
acceptanceCriteria:
  - "On a v2 tree, MCP health returns every field it returns today plus one added field carrying the v2 tree-rule results (and landing check) that CLI rex health shows, built by the same code (test)"
  - "No existing field of the MCP health response is removed or renamed (snapshot or shape test)"
  - "On a v1 tree the MCP health response is unchanged (existing tests pass unedited)"
  - "The added field has a changeset line fit for the release notes"
touches:
  - "61044424-6892-46b8-8b11-131e57373c91"
priority: "medium"
tags:
  - "v2-hardening"
  - "rex"
source: "ndx-capture"
---
