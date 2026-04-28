---
id: "feat-web-viewer-drilldown"
level: "task"
title: "Web viewer zone drill-down"
status: "completed"
startedAt: "2026-03-02T16:33:26.558Z"
completedAt: "2026-03-02T16:33:26.558Z"
description: "Phase 2: Add drill-down navigation in the web viewer so users can explore sub-zones interactively with breadcrumb navigation."
---

## Subtask: Add drill-down types and navigation state

**ID:** `task-drilldown-types`
**Status:** completed
**Priority:** high

In packages/web/src/viewer/views/zone-types.ts, add ZoneBreadcrumb {zoneId: string | null; label: string} interface. Extend ZoneData with subZones?: ZoneData[], subCrossings?: FlowEdge[], hasDrillDown?: boolean. In packages/web/src/viewer/views/zones.ts, add drillPath state (stack of ZoneBreadcrumb[]) starting at [{zoneId: null, label: 'All Zones'}]. Derive visibleZones and visibleCrossings from current drill level.

**Acceptance Criteria**

- ZoneBreadcrumb type defined
- ZoneData extended with subZones, subCrossings, hasDrillDown
- drillPath state in ZonesView with derived visibleZones/visibleCrossings

---

## Subtask: Implement breadcrumb navigation component

**ID:** `task-breadcrumb-nav`
**Status:** completed
**Priority:** high

Render breadcrumbs above diagram when drillPath.length > 1. Clicking a breadcrumb pops back to that level. Hidden at root level.

**Acceptance Criteria**

- Breadcrumbs render above diagram when drilled in
- Clicking breadcrumb navigates back to that level
- Hidden at root level (no unnecessary UI)

---

## Subtask: Add drill-down interaction to zone boxes

**ID:** `task-drilldown-interaction`
**Status:** completed
**Priority:** high

Add drill-down arrow button on zone boxes that have subZones. Click pushes new breadcrumb, re-renders diagram with sub-zones. Reset expanded zones on drill. Zone cards use visibleZones. Summary line reflects current drill level.

**Acceptance Criteria**

- Zones with subZones show drill-down affordance
- Clicking drill-down pushes breadcrumb and renders sub-zones
- Zone cards update to show sub-zone data
- Summary line reflects current drill level

---

## Subtask: Add drill-down tests

**ID:** `task-drilldown-tests`
**Status:** completed
**Priority:** medium

New test file packages/web/tests/unit/viewer/zone-drill-down.test.ts.

**Acceptance Criteria**

- Tests for breadcrumb rendering
- Tests for sub-zone diagram rendering after drill-down
- Tests for back navigation restoring parent view
- Tests for nested 3-level drill-down
- Tests for buildFlowEdges working with sub-crossings

---
