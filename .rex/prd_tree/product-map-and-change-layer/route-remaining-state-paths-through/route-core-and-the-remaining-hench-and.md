---
id: "d31d9aa8-e401-464a-918b-e757830a9ccc"
level: "task"
title: "Route core and the remaining hench and web file access through the resolver"
status: "completed"
priority: "medium"
tags:
  - "0.8.0"
  - "layout-resolver"
  - "pr-20"
blockedBy:
  - "c64f053e-96ef-4fc9-a9b5-f27f0f9cc1f5"
source: "Split from c64f053e (0.8.0 PR B3) on 2026-09-29 to avoid overlap with BN, A6 (#445) and A7 (#447)"
startedAt: "2026-10-06T04:45:03.239Z"
completedAt: "2026-10-06T06:15:40.295Z"
endedAt: "2026-10-06T06:15:40.295Z"
resolutionType: "code-change"
resolutionDetail: "Routed every remaining literal .rex/.hench/.sourcevision/.n-dx* path in packages/core, plus the enumerated hench and web files, through the layout resolver. Layout-literal debt 149 -> 56; core is now at zero. Added layoutStateNames() to both resolver twins for classifiers that must recognise both layouts, and stateDirNameUnder()/BOOKKEEPING_DIR_PREFIXES to hench's paths module (consolidating three copies of the same idiom). Fixed the detector's comment blanker, which read the /* inside a glob like \".hench/**\" as a block comment and hid 14 sites in 7 files."
acceptanceCriteria:
  - "No literal .rex/, .hench/ or .sourcevision/ path remains in core source, or in the hench/web files listed in the description, outside the resolver and paths modules."
  - "hench's completion commit and uncommitted-work checks stage and detect the PRD tree on the .ndx/ layout as well as the legacy layout (test)."
  - "core, hench and web test suites pass on the legacy layout, and each newly routed path is resolved under both layouts by a resolver or paths-module test."
description: "Start after A6 (#445) and A7 (#447) merge (BN merged as #449), on its own branch cut from main; c64f053e shipped as 0.8.0 PR B3 without it. Replace literal .rex/, .hench/ and .sourcevision/ paths with the resolver or the package paths modules in:\n- every packages/core file not already converted by A6;\n- the 16 hench/web files excluded from c64f053e: packages/hench/src/cli/commands/{cache,config,init,record,run,template,usage}.ts, packages/hench/src/cli/help.ts, packages/hench/src/schema/{v1,validate}.ts, packages/hench/src/store/artifacts.ts, packages/web/src/server/{hench-config-fields,routes-adaptive,routes-hench,routes-workflow}.ts, packages/web/src/viewer/views/hench-config.ts;\n- hench's git bookkeeping paths, left by c64f053e because run.ts imports PRD_COMMIT_PATHS as a static array: packages/hench/src/agent/lifecycle/uncommitted-work-gate.ts (PRD_WRITE_PATHS and the constants derived from it), agent/lifecycle/shared.ts (PRD paths to stage and report), agent/lifecycle/cli-loop.ts (reviewer-diff filter), validation/changed-files.ts (BOOKKEEPING_PREFIXES), store/file-classifier.ts. These are repo-relative git paths, so on the .ndx/ layout they must become the layout's directories relative to the repository root, not absolute paths;\n- packages/hench/src/schema/templates.ts (guard blockedPaths default, paired with the same literal in routes-hench.ts);\n- packages/web/src/server/merge-history.ts flattenPrdItems' `rexDir ?? \".rex\"` fallback.\n\nOut of scope (tracked separately): display-only paths in web viewer copy and heuristics, and hench prompt text.\n\nImplementation notes: packages/core orchestration uses the core resolver (packages/core/layout.js) and never imports other packages (config.js excepted); hench and web reach rex and sourcevision paths only through their gateways (hench src/prd/rex-gateway.ts; web src/server/rex-gateway.ts and domain-gateway.ts). Watch the export ceiling in tests/e2e/architecture-policy.test.js when adding gateway exports. Every user-facing change carries a changeset using the scoped package name with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-10-06T06:15:40.732Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
