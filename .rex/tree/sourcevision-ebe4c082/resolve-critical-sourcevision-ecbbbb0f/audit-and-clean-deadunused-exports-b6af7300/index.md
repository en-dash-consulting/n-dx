---
id: "b6af7300-9330-4523-97fc-119ea106a002"
level: "task"
title: "Audit and clean dead/unused exports"
status: "completed"
priority: "high"
startedAt: "2026-02-11T17:04:34.658Z"
completedAt: "2026-02-11T17:04:34.658Z"
acceptanceCriteria:
  - "Re-analysis shows no legitimate unused-export findings (excluding class methods and dynamically-used components)"
  - "sourcevision analyze reports 0 circular dependency chains in imports.json"
description: "Audit modules flagged for unused exports. For each, either remove genuinely dead code, internalize module-private helpers, or confirm the export is needed and document why.\n\n---\n\nEliminate the 2 circular dependency chains between tree.ts ↔ delete.ts and tree.ts ↔ stats.ts caused by backward-compatibility re-exports."
---

## Subtask: Decide on adjustments.ts: integrate or remove

**ID:** `76e50481-6fc8-4147-9729-1477971267d7`
**Status:** completed
**Priority:** medium

packages/hench/src/store/adjustments.ts has 9 unused exports and is documented as "infrastructure for a planned adaptive workflow feature — not yet integrated into the agent loop." Decide: if the feature is still planned, keep but mark with a tracking issue; if abandoned, delete the module entirely.

**Acceptance Criteria**

- Module is either deleted or has a documented plan for integration
- No unused exports remain if kept

---

## Subtask: Audit validate.ts — remove or justify uncalled validators

**ID:** `ab1b81d0-ed74-49f6-9a7a-c835e8016de4`
**Status:** completed
**Priority:** medium

packages/web/src/schema/validate.ts exports 8 validators flagged as unused (validateManifest, validateInventory, validateImports, validateZones, validateComponents, etc.). Audit each: if called from server routes or tests, keep; if truly dead, remove.

**Acceptance Criteria**

- Each exported validator is either confirmed used (with a call site) or removed
- pnpm typecheck passes

---

## Subtask: Audit health-gauge.ts — confirm components are rendered or remove

**ID:** `9ee0e1d6-8343-43f5-9fd0-65c799dfb230`
**Status:** completed
**Priority:** low

packages/web/src/viewer/components/data-display/health-gauge.ts exports 4 components (HealthGauge, HealthBadge, PatternBadge, MetricCard) flagged as unused. Check if they are rendered in any viewer page. Remove if dead, or document the dynamic usage pattern if alive.

**Acceptance Criteria**

- Each component is either confirmed rendered (with usage site) or removed
- pnpm typecheck passes

---

## Subtask: Internalize module-private helpers in reason.ts

**ID:** `8974f0a6-cba3-4ecc-a513-01df0cd8497f`
**Status:** completed
**Priority:** low

packages/rex/src/analyze/reason.ts has 54 exports across 2005 lines. 4 exports are flagged as unused (reasonFromScanResults, adjustGranularity, assessGranularity, reasonFromBatch). Audit: if these are only used within the module or by tests, remove the export keyword. If used cross-module, keep.

**Acceptance Criteria**

- No exports exist solely for internal use — only genuinely public API is exported
- pnpm typecheck passes
- pnpm test passes

---

## Subtask: Remove re-exports from tree.ts and update all callers

**ID:** `7cd9c5dc-8885-4392-b480-10d4679c7c0f`
**Status:** completed
**Priority:** high

tree.ts re-exports computeStats from stats.ts and deleteItem from delete.ts for backward compatibility, creating circular dependency chains. Remove these re-exports and update all call sites (~31 files) to import directly from the correct module (stats.ts or delete.ts).

**Acceptance Criteria**

- tree.ts no longer imports from delete.ts or stats.ts
- All callers of computeStats import from core/stats.ts
- All callers of deleteItem import from core/delete.ts
- pnpm typecheck passes
- pnpm test passes

---
