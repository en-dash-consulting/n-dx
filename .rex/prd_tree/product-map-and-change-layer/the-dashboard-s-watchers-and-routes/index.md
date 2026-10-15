---
id: "7a93b80b-7460-40c3-975d-5fd555ef4264"
level: "feature"
title: "The dashboard's watchers and routes hold up"
status: "pending"
priority: "medium"
tags:
  - "v2-hardening"
  - "web"
source: "roadmap"
acceptanceCriteria: []
description: "v2 hardening 4/5 (2026-10-14). ndx start's file watchers survive errors and follow recreated PRD folders, a test pins the v2 folders they watch, the bulk item PATCH validates like the single one, and a failed Product refetch keeps the loaded page. packages/web only. Branch feat/v2-hardening-4-dashboard."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-15T07:00:14.088Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [A failed Product refetch replaces the loaded map and an open capability page with an error](./a-failed-product-refetch-replaces-the.md) | completed |
| [Bulk PATCH /api/rex/items/bulk writes fields the single PATCH refuses](./bulk-patch-api-rex-items-bulk-writes.md) | completed |
| [Dashboard file watchers have no 'error' listener, so a watcher error crashes ndx start](./dashboard-file-watchers-have-no-error.md) | completed |
| [MCP schema watchers have no 'error' listener, so a dist/ watcher error crashes ndx start](./mcp-schema-watchers-have-no-error.md) | pending |
| [No test covers the PRD watcher refreshing the cache on product/ or changes/ edits](./no-test-covers-the-prd-watcher.md) | completed |
| [No test pins the Ask route passing the v2 merge rule to parseAnswerRefinements](./no-test-pins-the-ask-route-passing-the.md) | pending |
| [Rex watcher stops following a PRD folder that is deleted and recreated while ndx start runs](./rex-watcher-stops-following-a-prd.md) | completed |
