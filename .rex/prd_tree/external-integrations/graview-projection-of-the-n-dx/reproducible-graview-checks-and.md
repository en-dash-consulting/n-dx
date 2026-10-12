---
id: "ff5ad715-86a5-4cdd-8502-4c220c450133"
level: "task"
title: "Reproducible graview checks and documented naming divergences from rex"
status: "completed"
priority: "low"
tags:
  - "graview"
  - "docs"
source: "pr-review:#647"
startedAt: "2026-10-12T23:52:01.262Z"
completedAt: "2026-10-12T23:52:01.262Z"
endedAt: "2026-10-12T23:52:01.262Z"
resolutionType: "code-change"
resolutionDetail: "rex's v2 exports marked experimental in public.ts and docs/packages/rex.md; the feature's criteria name the checked-in fixtures and leave ../graview as manual dogfood; graview-projection.md lists every name that differs from rex, and document.test.ts fails on a new kind or relation the table does not name."
acceptanceCriteria:
  - "The public-surface doc marks the promoted rex v2 reader and derived-edge exports experimental"
  - "The feature's acceptance criteria name a checked-in fixture for the reproducible checks; the sibling-repo runs are described as manual"
  - "docs/architecture/graview-projection.md lists every kind and edge whose name or shape differs from rex's, and a test fails when a projection-only kind or edge is added without a row there"
description: "From the #647 review, points 5, 7 and 9. (5) The rex v2 reader and derived-edge exports went public while M1–M9 and PR 23's apply are open; list them as experimental in the public-surface doc. (7) The feature's criteria name ../graview, ../bee-bot and n-dx-graview, which are not in this public repo, so CI and outside contributors cannot run them; the reproducible checks should run on a checked-in fixture, with the sibling-repo dogfood a manual step. (9) The projection names some things differently from rex (the parent edge is `under`, rex's v2 says part of; a release is a node here and a field on a change in rex), so agents see one vocabulary over graview mcp and another over rex MCP."
lastModified: "2026-10-12T23:52:01.534Z"
lastModifiedBy: "Nick Daniel <nick@endash.us>"
---
