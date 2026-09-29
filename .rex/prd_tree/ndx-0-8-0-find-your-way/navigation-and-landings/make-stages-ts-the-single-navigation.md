---
id: "22d013f6-b2f5-46e3-a335-91ae32d2e934"
level: "task"
title: "Make stages.ts the single navigation model: one label, glyph, product and blurb per view, read by every navigation surface"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "navigation-landings"
  - "pr-23"
source: "caos work management: WM-2113 (Replace the accordion sidebar with a shared navigation model, always-open groups and a collapsed rail); 0.8.0 planning, PR 23 · Navigation and landings"
acceptanceCriteria:
  - "Every ViewId in shared/view-id.ts has exactly one navigation-model entry (label, glyph, product, blurb) and is placed exactly once: as home, a stage, a stage section or section alternate, or a settings entry (a unit test enumerates every ViewId)."
  - "The top nav, stage pages, Home cards, breadcrumb, document.title, guide titles and settings overlay take view labels from the model; a unit test renders the breadcrumb and the guide for every view and asserts each label equals the model's."
  - "No two views share a label: hench-runs is labelled Runs and activity is labelled Execution log."
  - "The restored-views and sourcevision-tabs assertions move onto the model rather than being deleted, and the restored-views test passes."
  - "Keyboard and screen-reader navigation of the top nav, stage links, stage sections and settings overlay is covered at desktop width and at 768px or narrower, where labels are hidden visually but every control keeps an accessible name (existing a11y harness in packages/web/tests/unit/viewer)."
description: "#425 replaced the accordion sidebar with three stages (Analysis, Plan, Work) defined in packages/web/src/viewer/views/stages.ts, a /home landing, stage pages, a settings overlay and a Commands sheet. The arrangement has one source, but view labels do not: components/breadcrumb.ts (VIEW_META), components/guide.ts (GUIDE_CONTENT) and views/sourcevision-tabs.ts (SOURCEVISION_TABS, read only by tests) each keep their own table, and they disagree with the stage section titles (Repository map vs Map, Add items vs Analyze & Import, and History used for both hench-runs and activity). Make stages.ts, or a sibling module it re-exports, the one navigation model: every ViewId has exactly one entry with its label, glyph, product and one-line blurb, and the top nav, stage pages, Home cards, breadcrumb and document.title, guide titles and settings overlay read labels from it.\n\nImplementation notes: Keep the model pure data with no Preact imports, reached from components through viewer/api.ts. Do not reintroduce a sidebar or a rail, and do not add a Flight Deck view (Flight Deck is 0.9.0; Work stands in for it in 0.8.0). Remove SOURCEVISION_TABS if nothing under src/ reads it, moving the assertions in tests/unit/viewer/restored-views.test.ts and sourcevision-tabs.test.ts onto the model rather than deleting them. Keep every view id in shared/view-id.ts registered in views/view-registry.ts and routable. Web viewer only: change nothing under packages/web/src/server/ or packages/hench/. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-29T17:30:37.082Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
