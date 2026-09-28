---
id: "0663c13a-823f-4074-975f-e062b3f6e726"
level: "task"
title: "Set the prune defaults from the 0.7.1 post-release measurement batch"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "rex-log-budget-tuners"
  - "pr-17"
source: "caos work management: WM-2138 (Set the prune defaults from the 0.7.1 post-release measurement batch); 0.8.0 planning, PR 17 · rex log and budget tuners"
acceptanceCriteria:
  - "The prune defaults are confirmed or changed, with the measurement batch cited in the changeset."
  - "Upgrading with no config change alters no run behaviour beyond the documented default change."
description: "The prune defaults (20 turn-pairs trigger, 10 retained) are still the values that were hard-coded before 0.7.1 made them configurable. Confirm or change them from the 0.7.1 post-release measurement batch.\n\nImplementation notes: Defaults live with ConversationPruner in packages/hench/src/agent/lifecycle/context-prune.ts and the hench.prune.* schema in packages/hench/src/schema/v1.ts; keep web's CONFIG_GROUP_DEFAULTS mirror (packages/web/src/server/hench-config-fields.ts) in step. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-25T18:12:46.000Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
