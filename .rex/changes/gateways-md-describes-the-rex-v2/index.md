---
id: "ea2102fe-3ca1-441d-8366-8bf338c1529a"
type: "change"
title: "gateways.md describes the rex v2 surface as it is after #648 and the restack"
slug: "gateways-md-describes-the-rex-v2"
intent: "Rescoped 2026-10-12 after the restack. Decision S1-Q1 (Ryan) was to export the product computations under #648's names; #648 has since merged into main and the stack is restacked onto it, so rex's public.ts already exports computeProductStatus, productReport, capabilityReport, prdStatusReport, isOpenChange, isAppliedChange, indexTree, loadPrdModel and prdLayout. The restack also removed A2's duplicate re-exports of prdLayout, loadPrdModel, PrdModel, LoadPrdModelOptions, V2Tree and RuleNode from public.ts (a second re-export of a name is TS2300 \"Duplicate identifier\"). No export work is left.\n\nWhat remains: docs/architecture/gateways.md, \"Rex v2 runtime surface\" (line ~33), still says \"a wider one is Nick's #648, and the names match the modules' own so the two merge cleanly\" and that no gateway re-exports the surface yet. Both are now wrong: #648 is on main; identical names did not merge cleanly (they were duplicate exports and had to be removed in the restack); and hench's and web's gateways re-export parts of this surface in this stack (PR 35, PR 36).\n\nFix: rewrite that paragraph to describe the surface as it is after the restack: #648's v2 model exports (reader, tree types, index, derived product computations) plus this PR's runtime additions (transaction, selection, completion, brief, ChangeLayerStore), which gateways re-export them, and the rule that a name must be exported from public.ts once. Keep the table accurate against public.ts. Docs only; no source change."
acceptanceCriteria:
  - "docs/architecture/gateways.md no longer says identical names merge cleanly or that no gateway re-exports the v2 surface; it names #648's exports as on main and this PR's runtime additions"
  - "Every name in its v2-surface table is exported from packages/rex/src/public.ts exactly once (checked against the file)"
  - "Docs only: no source change; the instruction-alignment and architecture-policy tests pass"
touches:
  - "b86f9199-bd84-45e8-95a8-bad39e42ebeb"
priority: "medium"
tags:
  - "pr-34"
  - "review-2026-10-12"
  - "lane-rex-domain"
source: "review-2026-10-12"
---
