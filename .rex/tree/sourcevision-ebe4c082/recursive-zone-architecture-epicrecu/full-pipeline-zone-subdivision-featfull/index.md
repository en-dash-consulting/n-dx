---
id: "feat-full-pipeline-subdivision"
level: "task"
title: "Full-pipeline zone subdivision"
status: "completed"
startedAt: "2026-03-02T16:28:00.235Z"
completedAt: "2026-03-02T16:28:00.235Z"
description: "Phase 1: Make subdivideZone use the same full Louvain pipeline as root analysis, with sub-crossings computation."
---

## Subtask: Add subCrossings field to Zone schema

**ID:** `task-subcrossings-schema`
**Status:** completed
**Priority:** high

Add optional subCrossings?: ZoneCrossing[] to Zone interface in packages/sourcevision/src/schema/v1.ts.

**Acceptance Criteria**

- Zone interface has optional subCrossings?: ZoneCrossing[]
- Field populated during subdivision
- Existing consumers unaffected (non-breaking)

---

## Subtask: Extract runZonePipeline from analyzeZones

**ID:** `task-extract-runzonepipeline`
**Status:** completed
**Priority:** critical

Extract the shared Louvain pipeline steps (buildUndirectedGraph, proximity edges, louvainPhase1, mergeBidirectionalCoupling, mergeSmallCommunities, capZoneCount, splitLargeCommunities, mergeSameIdCommunities, buildZonesFromCommunities, recursive subdivideZone, buildCrossings, assignByProximity) into a reusable runZonePipeline function in packages/sourcevision/src/analyzers/zones.ts. Accepts ZonePipelineOptions {edges, inventory, imports, scopeFiles, maxZones?, maxZonePercent?, parentId?, depth?, testFiles?} and returns ZonePipelineResult {zones, crossings, unzoned}.

**Acceptance Criteria**

- Shared function encapsulates Louvain pipeline steps
- analyzeZones refactored to call runZonePipeline
- All existing tests pass with identical output
- Function accepts maxZones, maxZonePercent, parentId, depth params

---

## Subtask: Rewrite subdivideZone to use full pipeline

**ID:** `task-rewrite-subdividezone`
**Status:** completed
**Priority:** critical

Replace the stripped-down Louvain in subdivideZone with a runZonePipeline call. Filter imports.edges to zone's internal edges, pass zone.files as scopeFiles, maxZones: 8, parentId: zone.id, depth: depth + 1. Prefix sub-zone IDs with zone.id/. Compute sub-crossings and store on zone.subCrossings. Thread testFiles through to subdivision.

**Acceptance Criteria**

- subdivideZone calls runZonePipeline instead of stripped-down Louvain
- Resolution escalation active during subdivision
- Proximity edges added for non-import files within zone
- mergeSameIdCommunities prevents duplicate sub-zone names
- Sub-crossings computed and stored on zone.subCrossings
- testFiles exclusion propagated to sub-zone metrics

---

## Subtask: Update zone-output.ts for sub-crossings

**ID:** `task-zone-output-subcrossings`
**Status:** completed
**Priority:** medium

In packages/sourcevision/src/analyzers/zone-output.ts, add a <sub-crossings> section to zone context.md generation showing cross-dependency counts between sub-zones grouped by zone pair.

**Acceptance Criteria**

- Zone context.md includes sub-crossings section when present
- Shows cross-dependency counts grouped by zone pair

---

## Subtask: Add subdivision enhancement tests

**ID:** `task-subdivision-tests`
**Status:** completed
**Priority:** high

New test file packages/sourcevision/tests/unit/analyzers/zone-subdivision.test.ts plus updates to existing zone-detection.test.ts.

**Acceptance Criteria**

- Tests for sub-crossings computation between sub-zones
- Tests for resolution escalation at subdivision level
- Tests for proximity edges at subdivision level
- Tests for mergeSameIdCommunities at subdivision level
- Tests for recursive multi-depth subdivision with sub-crossings
- Tests for testFiles exclusion propagation to sub-zone metrics
- End-to-end test: analyzeZones produces subCrossings on large zones
- Regression test: refactored pipeline produces identical output on existing fixtures

---
