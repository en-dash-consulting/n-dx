---
id: "c64f053e-96ef-4fc9-a9b5-f27f0f9cc1f5"
level: "task"
title: "Route hench and web file access through their paths modules"
status: "completed"
priority: "medium"
tags:
  - "0.8.0"
  - "layout-resolver"
  - "pr-20"
blockedBy:
  - "1ee864bc-c873-48a1-aedd-657448c3a5e1"
source: "caos work management: WM-2153 (Route hench, web and core file access through their paths modules); 0.8.0 planning, PR 20 · Layout resolver and path sweep"
startedAt: "2026-09-30T14:32:32.402Z"
completedAt: "2026-09-30T14:59:31.598Z"
endedAt: "2026-09-30T14:59:31.598Z"
resolutionType: "code-change"
resolutionDetail: "Routed real fs-access joins for .rex/.hench/.sourcevision through resolveHenchPaths/resolveWebPaths/resolveLayout across 19 hench+web source files (session-cache, primer, run-retention-scheduler, claude-quota, dead-code-analyzer, slug-migration-offer, uncommitted-work-gate's recovery dir in hench; start, workspaces, routes-worktrees, aggregation-cache, merge-history, routes-merge-graph, routes-token-usage, usage-cleanup-scheduler, routes-config, routes-status, routes-commands in web). Added layout-routing tests (new packages/hench/tests/integration/layout-routing.test.ts; extended web's aggregation-cache.test.ts and routes-commands.test.ts) proving both layouts resolve correctly. Full typecheck + full test suites green for both packages after rebuild. Left out of scope, with reasons: (1) git-porcelain-relative-path literals (changed-files.ts BOOKKEEPING_PREFIXES, file-classifier.ts, cli-loop.ts's reviewer-diff filter, uncommitted-work-gate.ts's PRD_WRITE_PATHS/PRD_COMMIT_PATHS, shared.ts's prdPathsToStage/scopePrdPathsToReport) are all downstream of PRD_COMMIT_PATHS, which the excluded cli/commands/run.ts imports as a static array — making it layout-aware would require editing an excluded file; (2) schema/templates.ts's guard blockedPaths default is paired with the identical literal already in excluded routes-hench.ts; (3) viewer-side path-prefix heuristics (files.ts, hench-runs.ts) and doc-snippet UI text are display-only, no fs access. These are exactly what the existing sibling task \"Route core and the remaining hench and web file access through the resolver\" should pick up once run.ts/artifacts.ts are back in scope."
acceptanceCriteria:
  - "No literal .rex/, .hench/ or .sourcevision/ path remains in hench or web source outside the resolver, the paths modules and the 16 excluded files."
  - "hench and web test suites pass on the legacy layout, and each newly routed path is resolved under both layouts by a paths-module test."
description: "Replace literal .rex/, .hench/ and .sourcevision/ paths in hench and web with the resolver or the package paths modules.\n\nScope: hench and web source only. Do not edit packages/core; core moves to a follow-up task. Do not edit these 16 files either; they belong to open PRs (BN feat/080-bn-vendor-aware-hench-config, A6 #445, A7 #447) and move to the follow-up task: packages/hench/src/cli/commands/{cache,config,init,record,run,template,usage}.ts, packages/hench/src/cli/help.ts, packages/hench/src/schema/{v1,validate}.ts, packages/hench/src/store/artifacts.ts, packages/web/src/server/{hench-config-fields,routes-adaptive,routes-hench,routes-workflow}.ts, packages/web/src/viewer/views/hench-config.ts.\n\nImplementation notes: hench and web reach rex and sourcevision paths only through their gateways (hench src/prd/rex-gateway.ts; web src/server/rex-gateway.ts and domain-gateway.ts); their own folders come from hench src/store/paths.ts and web src/server/paths.ts. Watch the export ceiling in tests/e2e/architecture-policy.test.js when adding gateway exports. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-30T14:59:31.967Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
