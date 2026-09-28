---
id: "a56a8025-c0ba-4e29-a581-d8c79b513472"
level: "task"
title: "Merge Map, Isometric Map and Zones into a tabbed Terrain page and Architecture and Routes into a tabbed Architecture page"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "navigation-landings"
  - "pr-23"
blockedBy:
  - "e8fb5412-e393-4e24-a104-8b14194066d1"
source: "caos work management: WM-2117 (Merge Map, Isometric Map and Zones into a tabbed Terrain page and Architecture and Routes into a tabbed Architecture page); 0.8.0 planning, PR 23 · Navigation and landings"
acceptanceCriteria:
  - "Terrain shows Map, Isometric Map and Zones as tabs; Architecture shows Architecture and Routes as tabs."
  - "Analyze & Import is labelled Plan and Context Graph is labelled Graph everywhere in the UI."
  - "The restored-views test passes because merged views stay registered as tabs."
  - "Every glossary line and the iso map's expand-in-place still render on the merged pages; their tests move with the views rather than being deleted."
description: "Consolidate related views into tabbed pages and rename Analyze & Import to Plan and Context Graph to Graph. The old view ids stay registered as tabs so nothing is orphaned. Two 0.7.1 additions move with their views and must survive the merge: the glossary definition lines (Files, Zones and its detail panel, the PRD tree, Workspaces, hench Config) and #410's readable zone hierarchy and iso-map areas that expand in place.\n\nImplementation notes: Build the tab containers in packages/web/src/viewer/views (reusing views/iso-map.ts, views/zones.ts, views/architecture.ts, views/routes.ts as tab bodies) and register the tab view ids in views/view-registry.ts. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-25T18:12:46.000Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
