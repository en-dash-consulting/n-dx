---
id: "107fb07a-4c1a-4be0-94b3-0fcd12043962"
level: "task"
title: "Add scoped list and clear for Codex cache entries with automatic eviction"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "codex-cache-safety"
  - "pr-19"
blockedBy:
  - "0c437e81-6092-45e7-a5dd-358d2c662184"
source: "caos work management: WM-2148 (Add scoped list and clear for Codex cache entries with automatic eviction); 0.8.0 planning, PR 19 · Codex cache safety"
acceptanceCriteria:
  - "Users can list and clear cache entries for a scope without editing JSON."
  - "Expired, failed and malformed entries are evicted automatically (tests)."
  - "No cache file contains prompt content (test)."
description: "Users need to inspect and clear cache entries for a scope without editing JSON, and expired, failed and malformed entries should be evicted automatically. Prompt content is never persisted.\n\nImplementation notes: Add list/clear functions beside readBatchChain/clearBatchChain in packages/hench/src/agent/lifecycle/session-cache.ts and expose them as a hench CLI subcommand with help text in cli/help.ts. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-25T18:12:46.000Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
