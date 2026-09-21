---
id: "193943e5-2c3e-4dca-8777-ab76fdf2eec2"
level: "task"
title: "Enumerate and remove unused imports in all production source files"
status: "completed"
priority: "high"
tags:
  - "dead-code"
  - "refactor"
  - "cleanup"
source: "smart-add"
startedAt: "2026-05-26T01:42:14.497Z"
completedAt: "2026-05-26T01:49:30.619Z"
endedAt: "2026-05-26T01:49:30.619Z"
resolutionType: "code-change"
resolutionDetail: "Removed 82 unused imports across 63 production source files in 6 packages. Net reduction of 267 lines (389 deleted, 164 added). All tests pass, TypeScript compilation succeeds."
acceptanceCriteria:
  - "Zero unused import declarations remain in any production TypeScript or JavaScript file across all packages"
  - "Test files are excluded from the analysis pass"
  - "pnpm build completes with zero TypeScript errors after the sweep"
  - "pnpm test passes with the same pass/fail counts as the baseline run"
  - "A per-package diff summary shows measurable net line reduction (at least 50 lines total removed)"
description: "Configure and run a static-analysis tool (knip, ts-prune, or eslint no-unused-vars with the TypeScript resolver) across all six packages targeting production files only. For each unused import confirmed by the tool, remove the declaration. Where removal causes a type error, investigate whether the import was masking a missing explicit type annotation and fix accordingly. Verify pnpm build and pnpm test pass after the full sweep."
---
