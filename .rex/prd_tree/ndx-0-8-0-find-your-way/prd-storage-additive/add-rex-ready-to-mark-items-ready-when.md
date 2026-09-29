---
id: "d417fda4-0b26-4c16-8482-842788bdbc5f"
level: "task"
title: "Add rex ready to mark items ready when they have an automated or metric requirement and no open blocker"
status: "in_progress"
priority: "medium"
tags:
  - "0.8.0"
  - "prd-storage-additive"
  - "pr-18"
source: "caos work management: WM-2130 (Add rex ready to mark items ready when they have an automated or metric requirement and no open blocker); 0.8.0 planning, PR 18 · PRD storage additive"
startedAt: "2026-09-29T04:15:56.974Z"
acceptanceCriteria:
  - "rex ready marks qualifying items and explains why others do not qualify."
  - "A tree with no ready fields selects tasks exactly as today (test)."
description: "rex ready marks an item ready when it has at least one automated or metric requirement and no open blocker.\n\nImplementation notes: Add the field to packages/rex/src/schema/v1.ts as optional, the command under cli/commands, and read requirements via core/requirements.ts. Serializer and parser (store/folder-tree-serializer.ts, folder-tree-parser.ts) must round-trip the field and omit it when unset. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-29T04:15:57.336Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
