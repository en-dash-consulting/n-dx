---
id: "09b2b8de-d993-44e6-b944-4bef6b47a5aa"
type: "change"
title: "MCP health on a v2 tree without .rex/config.json errors instead of returning its score"
slug: "mcp-health-on-a-v2-tree-without-rex"
intent: "Found 2026-10-14 by the operator while verifying 4dad9dc0 on a copy of packages/rex/tests/fixtures/v2-tree (which has no .rex/config.json). Before this layer, MCP health on that copy returned overall, dimensions and suggestions. After 4dad9dc0 it returns an error: ENOENT .rex/config.json, because the v2 report it now adds reads the config (cli/commands/health.ts computeV2Health). With a config.json present it returns every old field plus v2. CLI rex health already refuses a project without config.json (NDX_CLI_CONFIG_NOT_FOUND) and that is unchanged. MCP tool shapes are soft-frozen, so the old fields must not disappear.\n\nOperator notes: do not edit packages/rex/tests/unit/schema/v2.test.ts (owned by another session); keep v2 imports in modules already on its allowlist. Run the six static root policy tests before finishing: tests/e2e/architecture-policy, domain-isolation, shell-spawn-inventory-policy, wall-clock-inventory-policy, layout-literal-policy and obfuscated-code-policy."
acceptanceCriteria:
  - "On a v2 tree with no .rex/config.json, MCP health returns overall, dimensions and suggestions as it did before this layer, plus the v2 field built with default config, or without the v2 field and a note naming the missing config (test)"
  - "With a config.json present, the MCP health response is unchanged (existing tests pass)"
  - "CLI rex health behaviour is unchanged"
touches:
  - "61044424-6892-46b8-8b11-131e57373c91"
priority: "low"
tags:
  - "v2-hardening"
  - "rex"
source: "ndx-capture"
---
