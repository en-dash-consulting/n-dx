---
id: "8cc70b76-8b1f-4506-8f5e-799cc153468d"
level: "feature"
title: "Generate the migration plan"
status: "pending"
priority: "high"
tags:
  - "product-map"
  - "pr-13"
  - "lane-migration"
  - "rex"
  - "core"
blockedBy:
  - "dc3b80c1-4d3c-486f-ba03-0b6bbe9fd50d"
  - "51527b42-cc67-4a5a-83b3-61179298dfaf"
source: "roadmap"
acceptanceCriteria: []
description: "ndx migrate --plan writes a reviewable plan and moves nothing. It reads the v1 tree only, so it can run early and feed the area review.\n\nRoadmap PR 13 · wave 1 · lane migration."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-06T15:51:24.007Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [A seam failure mid-pass discards every model answer the plan already paid for](./a-seam-failure-mid-pass-discards-every.md) | pending |
| [Classify the v1 tree and propose areas and constraints](./classify-the-v1-tree-and-propose-areas.md) | completed |
| [Draft capability specs with a text model by default](./draft-capability-specs-with-a-text.md) | pending |
| [Draft present-tense capability specs grounded in code and tests](./draft-present-tense-capability-specs.md) | completed |
| [Enriched placement in the migration plan: text by default, Jev when configured](./enriched-placement-in-the-migration.md) | pending |
| [Give migrations a home: framework and the v1-to-v2 folder](./give-migrations-a-home-framework-and.md) | completed |
| [Migration contract does not say a model question must carry every input its answer depends on, so a minimal question reuses a stale answer](./migration-contract-does-not-say-a.md) | pending |
| [Migration plan and freeSlug can freeze the slug "index", which the v2 writer refuses on a leaf](./migration-plan-and-freeslug-can-freeze.md) | pending |
| [Migration plan checks slugs against v1 siblings, so items that become v2 siblings can share a slug and the writer refuses the tree](./migration-plan-checks-slugs-against-v1.md) | pending |
| [Migration plan emits two different criteria sets for a capability, so reviewedHash can mismatch the migrated spec](./migration-plan-emits-two-different.md) | pending |
| [Migration plan makes cancelled or deleted v1 epics and features into standing areas and capabilities](./migration-plan-makes-cancelled-or.md) | pending |
| [Migration plan turns a version-numbered epic that is not a release into a release umbrella (e.g. "Python 3.12 support")](./migration-plan-turns-a-version.md) | pending |
| [Optional Jev judgments and confidence for the migration plan](./optional-jev-judgments-and-confidence.md) | pending |
| [Plan ids, aliases, backfill and data fixes](./plan-ids-aliases-backfill-and-data-fixes.md) | completed |
| [Stamp appliedAt and reviewedHash when migrating historical items](./stamp-appliedat-and-reviewedhash-when.md) | completed |
| [The migration can freeze a Windows-unsafe v1 slug (con, aux, nul) into v2, leaving the tree permanently unwritable](./the-migration-can-freeze-a-windows.md) | completed |
