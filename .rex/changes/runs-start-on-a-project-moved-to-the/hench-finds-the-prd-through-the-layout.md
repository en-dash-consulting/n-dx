---
id: "3ba44ab7-cdf3-4f36-b4e9-c0cbc566ef3f"
type: "task"
title: "hench finds the PRD through the layout resolver when its configured rexDir is the legacy default, and migrate-layout rewrites it"
slug: "hench-finds-the-prd-through-the-layout"
description: "hench task selection joins config.rexDir from hench config.json instead of the layout resolver (packages/llm-client/src/layout.ts:155, core/layout.js) that rex, web and hench's own bookkeeping use: packages/hench/src/cli/commands/run.ts:1900 (ndx work), run-resolve.ts:263 (--resolve, read by the Sidecar preview through web/src/server/sidecar/carry-out.ts:282) and plan-queue.ts:180. On the .ndx/ layout a stored \".rex\" (the schema default, hench/src/schema/v1.ts:772) points at a folder that does not exist. Fix: one helper resolves hench's rex dir — when the configured value is the legacy default \".rex\" and the layout resolves a different rexDir, use the layout's; a deliberate non-default value still wins; all three call sites use it. hench/src/tools/rex.ts:161 stops hard-coding PROJECT_DIRS.REX. ndx migrate-layout (packages/core/migrate-layout.js:319) rewrites hench config rexDir from \".rex\" to the new rex dir when it equals the legacy default, and verifyMigration checks it. The dashboard's hench config field default (web/src/server/hench-config-fields.ts:114) shows the layout's value. Shared rules: viewer code reaches messaging only through src/viewer/external.ts and src/viewer/api.ts and imports hooks and components through their barrels (tests/integration/boundary-check.test.ts); style only with tokens from styles/tokens.css in both themes; do not edit packages/web/AGENTS.md or src/server/AGENTS.md; nothing turns on web.sidecar; run the static root policy suites (architecture-policy, domain-isolation, shell-spawn inventory, wall-clock inventory, layout-literal, obfuscated-code) before finishing; add a patch changeset per package touched."
acceptanceCriteria:
  - "With .ndx/ layout and rexDir \".rex\" in hench config, ndx work --task, --resolve and --plan-queue find the task (hench tests)"
  - "A non-default configured rexDir still wins (hench test)"
  - "migrate-layout rewrites a legacy-default rexDir and leaves a custom one alone (core test)"
priority: "high"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
