---
id: "163ae23d-7ae6-49b5-8262-3a4d44c124e8"
level: "task"
title: "rex usage ignores .n-dx.json rex overrides: token-store passes the wrong dir and key to loadProjectOverrides"
status: "completed"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
startedAt: "2026-10-15T05:58:03.034Z"
completedAt: "2026-10-15T06:04:10.386Z"
endedAt: "2026-10-15T06:04:10.386Z"
resolutionType: "code-change"
resolutionDetail: "token-store now calls loadProjectOverrides(rexDir, \"rex\"); new unit test covers .n-dx.json and .ndx/ layouts."
acceptanceCriteria:
  - "loadTokenUsageConfig applies rex.budget from .n-dx.json next to the .rex directory"
  - "A unit test writes .n-dx.json with rex.budget in a temp project and asserts the merged config; it fails on the current code"
description: "Verdict: out-of-scope (pre-existing; found while reviewing PR 12 placement settings).\n\npackages/rex/src/core/token-store.ts:21 calls loadProjectOverrides(dirname(rexDir), PROJECT_DIRS.REX). loadProjectOverrides expects the package config dir (it takes dirname itself) and the section key \"rex\"; this passes the project dir (so it reads the parent of the project) and the key \".rex\". Scenario: .n-dx.json { \"rex\": { \"budget\": { ... } } } -> loadTokenUsageConfig returns only .rex/config.json values; budget overrides from .n-dx.json are silently ignored by `rex usage` / token-format.\n\nFix: loadProjectOverrides(rexDir, \"rex\") (as file-adapter.ts and core/placement-policy.ts do), plus a test with a temp project. Cheap, low risk.\n\nOperator note (overnight 2026-10-15): Fix in packages/rex/src/core/token-store.ts only, plus a new unit test (e.g. packages/rex/tests/unit/core/token-store-overrides.test.ts) that writes .rex/config.json and .n-dx.json with rex.budget in a temp project and asserts the merged config. If cheap, also cover the .ndx/ layout (<tmp>/.ndx/rex with .n-dx.json at <tmp>). Do not edit these files, which other sessions own tonight: packages/rex/src/core/apply-amendments.ts, packages/rex/src/core/change-completion.ts, packages/rex/src/migrations/, packages/rex/src/store/prd-model-writer.ts, packages/rex/src/cli/index.ts, packages/rex/src/cli/help.ts, the rex MCP tool handlers (update_task_status, edit_item, move_item, merge_items, claim_task, health), packages/rex/tests/unit/schema/v2.test.ts, hench run and task-lookup source, packages/web, packages/sourcevision, packages/core/cli.js, help.js, command-effects.js, README.md, docs/guide/commands.md, tests/setup-session-env.js. If the fix needs one of them, stop and say so in your summary instead of editing it. The pinning test must fail on the code before your fix; say in your summary how you checked that. Run the six static root policy tests (tests/e2e/architecture-policy, domain-isolation, shell-spawn-inventory-policy, wall-clock-inventory-policy, layout-literal-policy, obfuscated-code-policy) before committing. Do not add a changeset; the operator adds one per layer."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-15T06:04:11.157Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
