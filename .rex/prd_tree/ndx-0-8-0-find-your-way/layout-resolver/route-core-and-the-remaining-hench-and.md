---
id: "d31d9aa8-e401-464a-918b-e757830a9ccc"
level: "task"
title: "Route core and the remaining hench and web file access through the resolver"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "layout-resolver"
  - "pr-20"
blockedBy:
  - "c64f053e-96ef-4fc9-a9b5-f27f0f9cc1f5"
source: "Split from c64f053e (0.8.0 PR B3) on 2026-09-29 to avoid overlap with BN, A6 (#445) and A7 (#447)"
acceptanceCriteria:
  - "No literal .rex/, .hench/ or .sourcevision/ path remains in core source, or in the 16 hench/web files excluded from c64f053e, outside the resolver and paths modules."
  - "core, hench and web test suites pass on the legacy layout, and each newly routed path is resolved under both layouts by a resolver or paths-module test."
description: "Start after BN (feat/080-bn-vendor-aware-hench-config), A6 (#445) and A7 (#447) merge. Replace literal .rex/, .hench/ and .sourcevision/ paths with the resolver or the package paths modules in: every packages/core file not already converted by A6, and the 16 hench/web files excluded from c64f053e: packages/hench/src/cli/commands/{cache,config,init,record,run,template,usage}.ts, packages/hench/src/cli/help.ts, packages/hench/src/schema/{v1,validate}.ts, packages/hench/src/store/artifacts.ts, packages/web/src/server/{hench-config-fields,routes-adaptive,routes-hench,routes-workflow}.ts, packages/web/src/viewer/views/hench-config.ts.\n\nImplementation notes: packages/core orchestration uses the core resolver (packages/core/layout.js) and never imports other packages (config.js excepted); hench and web reach rex and sourcevision paths only through their gateways (hench src/prd/rex-gateway.ts; web src/server/rex-gateway.ts and domain-gateway.ts). Watch the export ceiling in tests/e2e/architecture-policy.test.js when adding gateway exports. Every user-facing change carries a changeset using the scoped package name with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-29T21:04:50.585Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
