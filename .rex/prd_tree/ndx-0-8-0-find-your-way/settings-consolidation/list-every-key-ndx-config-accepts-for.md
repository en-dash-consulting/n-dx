---
id: "1f358780-a9a5-4848-b9dc-e376e60642dd"
level: "task"
title: "List every key ndx config accepts for hench on the Workflow page and in hench config"
status: "completed"
priority: "medium"
tags:
  - "0.8.0"
  - "settings-consolidation"
  - "pr-24"
blockedBy:
  - "22226abd-53df-411b-803a-4f96e0325356"
source: "caos work management: WM-2141 (List every key ndx config accepts for hench on the Workflow page and in hench config); 0.8.0 planning, PR 24 · Settings consolidation"
startedAt: "2026-09-29T16:54:14.158Z"
completedAt: "2026-09-29T17:34:40.933Z"
endedAt: "2026-09-29T17:34:40.933Z"
resolutionType: "code-change"
resolutionDetail: "hench's CONFIG_FIELDS is now the source list and covers every key HenchConfigSchema defines (54). web's CONFIG_FIELD_META mirrors it path-for-path and the Workflow page renders all nine categories; ndx config --help documents the same set. tests/e2e/hench-config-gate-contract.test.js compares the three lists and pins each recorded default against hench's own."
acceptanceCriteria:
  - "Every key ndx config accepts for hench appears on the Workflow page and in hench config (test compares the lists)."
description: "hench config's curated key list is missing about 14 keys that ndx config accepts, promptCacheTtl among them. The Workflow page and hench config should list the same keys.\n\nImplementation notes: Compare the key list in packages/hench/src/cli/commands/config.ts with packages/core/config.js and packages/web/src/server/hench-config-fields.ts; derive them from one source if practical. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-29T17:34:41.771Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
