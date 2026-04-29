---
id: "49975940-0615-48e5-9538-0f3cda2407d3"
level: "task"
title: "Globalize Token Usage Route Ownership"
status: "completed"
source: "smart-add"
startedAt: "2026-02-22T21:40:06.085Z"
completedAt: "2026-02-22T21:40:06.085Z"
acceptanceCriteria: []
description: "Make Token Usage a first-class global dashboard destination instead of a Rex-scoped view so routing and UI metadata remain consistent across sections."
---

## Subtask: Remove token-usage from Rex view scope registry

**ID:** `39c0d90c-8a76-4a7a-96e8-ab7b7469433f`
**Status:** completed
**Priority:** critical

Prevent Rex-scoped route resolution from claiming Token Usage by deleting the token-usage entry from `VIEWS_BY_SCOPE.rex`. This eliminates conflicting ownership and ensures the route is resolved by global navigation config only.

**Acceptance Criteria**

- `VIEWS_BY_SCOPE.rex` no longer contains a `token-usage` entry
- Route resolution for `token-usage` does not depend on Rex scope helpers
- Existing Rex-only views still resolve without regression after the removal

---

## Subtask: Re-map token-usage in route state and UI metadata as global

**ID:** `904f9499-4d53-4480-aab7-f91159d14c54`
**Status:** completed
**Priority:** high

Update route-state, breadcrumb, and product-label mapping tables so Token Usage is classified as global/cross-cutting rather than Rex-owned, preventing incorrect section highlights and labels.

**Acceptance Criteria**

- Route-state mapping classifies `token-usage` under global scope
- Breadcrumbs for `token-usage` render without Rex section ancestry
- Product/section labels for `token-usage` show global ownership consistently in header and nav

---
