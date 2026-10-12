---
id: "ea2102fe-3ca1-441d-8366-8bf338c1529a"
level: "task"
title: "Export the product computations the dashboard views need, under #648's names"
status: "pending"
priority: "high"
tags:
  - "pr-34"
  - "review-2026-10-12"
  - "lane-rex-domain"
source: "review-2026-10-12"
acceptanceCriteria:
  - "public.ts exports computeProductStatus, productReport, capabilityReport, isOpenChange and isAppliedChange with #648's spelling and source modules (test importing them from @n-dx/rex's public entry, which fails on 1ea7984bfb)"
  - "docs/architecture/gateways.md no longer says identical names merge cleanly; it says whichever of stack 1 and #648 lands second drops its copies, and lists the shared names"
  - "The changeset's public-entry list names the new exports; the v2 isolation and domain-isolation tests pass"
description: "Review 2026-10-12, PR #693 claims-checked note on D1.2 and PR #690 should-fix 2 (CONFIRMED by git merge-tree). Decision S1-Q1 (Ryan, 2026-10-12): stack 1 exports the product computations under #648's spelling; Nick's #648 then rebases and drops the names stack 1 already exports.\n\nWhy: the dashboard's Product, Changes and capability views (901a3775, D1.2 in PR 36) need rex's product computations. At this head packages/rex/src/public.ts exports none of computeProductStatus, productReport, capabilityReport, isOpenChange or isAppliedChange, although all exist internally. The PR 14 view model (web viewer/views/product-model.ts) takes capability status/health, change stage and open-change overlays as already-computed inputs, so a web-local computation would be a second definition. #648 (origin/feat/rex-v2-public-api, 0c0c86156) exports exactly these.\n\nAlso correct docs/architecture/gateways.md:33. It says \"the names match the modules' own so the two merge cleanly\", which is wrong: A2 re-exports prdLayout, loadPrdModel, PrdModel, LoadPrdModelOptions, V2Tree and RuleNode at public.ts:581-585, #648 exports the same six near line 80, and git auto-merges public.ts with the names twice (merged lines 81/82/97 and 621/622/625). A duplicate re-export is TS2300 \"Duplicate identifier\", so the rex build breaks. The doc must say that whichever lands second drops its copies of the names the other already exports, and list them (the six above plus the five added here).\n\nFix: export computeProductStatus, productReport, capabilityReport, isOpenChange and isAppliedChange (and the types their signatures need) from public.ts with #648's exact spelling and source modules, copying #648's export block where it covers these names. Add the newly exporting modules to the v2 isolation allowlist (packages/rex/tests/unit/schema/v2.test.ts) if needed. Update the changeset's public-entry list. Read #648's export block with `git show origin/feat/rex-v2-public-api:packages/rex/src/public.ts`; do not merge #648."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T18:20:59.194Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
