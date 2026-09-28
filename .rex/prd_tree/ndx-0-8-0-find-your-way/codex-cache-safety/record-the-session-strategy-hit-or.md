---
id: "adc8930f-0411-461c-956c-47f6438a228b"
level: "task"
title: "Record the session strategy, hit or miss reason and token-data provenance on every run"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "codex-cache-safety"
  - "pr-19"
blockedBy:
  - "0c437e81-6092-45e7-a5dd-358d2c662184"
source: "caos work management: WM-2149 (Record the session strategy, hit or miss reason and token-data provenance on every run); 0.8.0 planning, PR 19 · Codex cache safety"
acceptanceCriteria:
  - "Every run record reports strategy and decision reason."
  - "Codex cache data shows measured, estimated or unavailable, never zero for unknown."
  - "Run records written before this change still load (test with an old fixture)."
description: "Every run records which strategy was used, the hit or miss reason, session age, and whether token data is measured, estimated or unavailable, summarised in the CLI and dashboard.\n\nImplementation notes: Add optional fields to the run record schema in packages/hench/src/schema/v1.ts, populate them in the loop (agent/lifecycle/loop.ts / cli-loop.ts), show them in cli/commands/show.ts and in the dashboard hench runs view (packages/web/src/viewer/views/hench-runs.ts). Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-25T18:12:46.000Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
