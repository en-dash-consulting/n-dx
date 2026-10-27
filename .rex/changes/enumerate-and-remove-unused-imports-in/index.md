---
id: "193943e5-2c3e-4dca-8777-ab76fdf2eec2"
type: "change"
title: "Enumerate and remove unused imports in all production source files"
slug: "enumerate-and-remove-unused-imports-in"
intent: "Configure and run a static-analysis tool (knip, ts-prune, or eslint no-unused-vars with the TypeScript resolver) across all six packages targeting production files only. For each unused import confirmed by the tool, remove the declaration. Where removal causes a type error, investigate whether the import was masking a missing explicit type annotation and fix accordingly. Verify pnpm build and pnpm test pass after the full sweep."
acceptanceCriteria:
  - "Zero unused import declarations remain in any production TypeScript or JavaScript file across all packages"
  - "Test files are excluded from the analysis pass"
  - "pnpm build completes with zero TypeScript errors after the sweep"
  - "pnpm test passes with the same pass/fail counts as the baseline run"
  - "A per-package diff summary shows measurable net line reduction (at least 50 lines total removed)"
touches:
  - "56f47d3d-d39d-4938-9923-b3735656ba7b"
priority: "high"
tags:
  - "dead-code"
  - "refactor"
  - "cleanup"
source: "smart-add"
---
