---
id: "189ba599-0232-4824-ad92-123bcf4935f9"
level: "task"
title: "Add a glossary source and render definition lines under the dashboard fields that use its terms"
status: "pending"
priority: "medium"
tags:
  - "0.7.1"
  - "trust-copy"
  - "wm-2041"
source: "caos work management: WM2041 (Add a glossary source and render definition lines under the dashboard fields that use its terms); 0.7.1 execution plan PR group"
acceptanceCriteria:
  - "A single glossary module holds every term and definition and is the only place definitions are written."
  - "Each term has a definition line rendered where it first appears on Files (archetype), Zones and Terrain (zone, zone pin), Suggestions (weight, guard rail), enrichment thresholds (enrichment pass), and the PRD tree (epic / feature / task)."
  - "A unit test asserts every glossary term is rendered by at least one component."
  - "No change to view ids, routes, config keys or --format=json output."
description: "An outside first-use review could not tell what zone, zone pin, enrichment pass, archetype, weight or guard rail meant, because the dashboard shows the terms with no explanation. Add one glossary source of truth and render a one-line definition under the first field or column header that uses each term on a page. Terms to cover: zone, zone pin, enrichment pass, archetype, weight, guard rail, epic / feature / task, worktree anchor. Copy only: no new route, view id or config key.\n\nImplementation notes: Create a framework-agnostic glossary module under packages/web/src/shared/ (the shared layer with zero upward dependencies) exporting an array of {term, definition} for: zone, zone pin, enrichment pass, archetype, weight, guard rail, epic / feature / task, worktree anchor. Write plain-language one-sentence definitions grounded in the code (zone = a cluster of files that import each other more than they import anything else, detected by community detection; archetype = the role sourcevision assigns a file, overridable per file; and so on). Add a small viewer component that renders a definition line under a field or column header, and use it at the first appearance of each term in packages/web/src/viewer/views/files.ts, the zones and terrain views, suggestions, enrichment-thresholds.ts and the PRD tree view. Add a unit test that each glossary term is referenced by at least one view. Do not add a route or view id. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-21T17:24:13.185Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
