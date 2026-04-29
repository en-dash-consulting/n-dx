---
id: "2619bd1f-1c65-4a1f-af96-16a84294e3b6"
level: "task"
title: "Address observation issues (3 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-05T04:50:57.123Z"
completedAt: "2026-03-05T05:02:40.864Z"
acceptanceCriteria: []
description: "- 5 circular dependency chains detected — see imports.json for details\n- The message zone's low cohesion (0.45) combined with being the most-imported zone in the web layer suggests it has grown into a catch-all communication module; splitting it into typed message definitions and transport utilities would improve cohesion and make the import graph more precise.\n- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 22 files — high-impact module, changes may have wide ripple effects\n\n---\n\nFixes for cross-level matching bugs in smart-add duplicate merge logic."
recommendationMeta: "[object Object]"
---

## Subtask: Break rex analyze circular dependency (reason.ts ↔ extract.ts)

**ID:** `6731fd26-e5a3-4e43-89f2-f42b7fd7c19a`
**Status:** completed
**Priority:** high

reason.ts dynamically imports extract.ts (lines 1224, 2050, 2061), and extract.ts statically imports utilities from reason.ts (detectFileFormat, spawnClaude, extractJson, etc.). file-validation.ts also imports FileFormat type from reason.ts. Extract shared utilities (detectFileFormat, extractJson, repairTruncatedJson, emptyAnalyzeTokenUsage, accumulateTokenUsage, PRD_SCHEMA, TASK_QUALITY_RULES, OUTPUT_INSTRUCTION, FileFormat type) into a new shared module that both reason.ts and extract.ts can import from without creating a cycle.

**Acceptance Criteria**

- No circular dependency between reason.ts, extract.ts, and file-validation.ts
- All existing tests pass
- No changes to public API

---

## Subtask: Break sourcevision circular dependency (enrich.ts ↔ zones.ts)

**ID:** `2b20ad08-82b9-4275-acee-69c06b9b13a7`
**Status:** completed
**Priority:** high

enrich.ts imports computeGlobalContentHash from zones.ts, while zones.ts imports enrichZonesWithAI and enrichZonesPerZone from enrich.ts. Move computeGlobalContentHash to a shared utility module or pass it as a dependency to break the cycle.

**Acceptance Criteria**

- No circular dependency between enrich.ts and zones.ts
- All existing tests pass
- No changes to public API

---

## Subtask: Document message zone architecture and rex schema fan-in hotspot

**ID:** `5a11ecb9-002e-4e3d-a165-3658d8f9dc49`
**Status:** completed
**Priority:** medium

Two observation findings that don't require code restructuring: (1) Viewer Message Flow Control zone has low cohesion (0.45) because message-coalescer and message-throttle are independent utilities - add a module doc explaining they're a messaging-primitives library. (2) rex/schema/index.ts has 42 importers (fan-in hotspot) - this is expected for a schema barrel; add a doc comment warning about change impact.

**Acceptance Criteria**

- Message zone has documentation explaining its architecture
- Rex schema barrel has doc comment about high fan-in and change impact

---

## Subtask: Fix cross-level matching in smart-add duplicate merge

**ID:** `8b518f76-029b-42af-b9bd-7eadb183c008`
**Status:** completed
**Priority:** high

The smart-add duplicate detection (`matchProposalNodeToPRD` in `smart-add-duplicates.ts`) walks the entire PRD tree and scores every item against each proposal node with no level filtering. A proposed epic can match an existing task, a proposed feature can match an existing epic, etc. This causes two failure modes:

1. **Crash + partial state** — A proposed epic matches an existing task/feature. The merge target ID is used as `epicId` in `acceptProposals`. When it tries to add a new feature under this "epic" (actually a task), `insertChild` rejects the hierarchy mismatch (`tree.ts:65`), `addItem` throws (`file-adapter.ts:50`), and the loop aborts mid-way. Items added before the crash are already persisted → partial, broken PRD.

2. **Silent structural corruption** — A proposed feature matches an existing epic. The merge target ID becomes `featureId`. New tasks are added with `featureId` = an epic ID. Since `LEVEL_HIERARCHY.task` allows parent `["feature", "epic"]`, `insertChild` succeeds — but tasks become direct children of the epic, orphaned from any feature grouping.

**Fix required (3 parts):**

1. **Primary: Add level filtering to `matchProposalNodeToPRD`** (`smart-add-duplicates.ts:288-323`) — only match epic↔epic, feature↔feature, task↔task. Add a guard in `scoreNodeAgainstItem` or in the caller's loop: skip items whose `level` doesn't match `node.kind`.

2. **Secondary: Validate merge targets in `acceptProposals`** (`smart-add.ts:~791-880`) — before using a merge target ID as a parent, verify the existing item has the expected level. If not, fall back to creating a new item instead of silently using the wrong parent.

3. **Optional: Batch mutations for atomicity** — currently each `store.addItem()` individually loads/saves the document. If any add fails mid-loop, previously persisted items stay → inconsistent partial state. Consider collecting all mutations and saving once at the end.

**Key files:**
- `packages/rex/src/cli/commands/smart-add-duplicates.ts` — `matchProposalNodeToPRD` (lines 288-323), `scoreNodeAgainstItem` (lines 213-250)
- `packages/rex/src/cli/commands/smart-add.ts` — `acceptProposals` (lines ~787-883), `applyDuplicateProposalMerges` (lines 458-533)
- `packages/rex/src/store/file-adapter.ts` — `addItem` (lines 45-56)
- `packages/rex/src/core/tree.ts` — `insertChild` (lines 50-78)

**Acceptance Criteria**

- matchProposalNodeToPRD only matches nodes against PRD items of the same level (epic↔epic, feature↔feature, task↔task)
- acceptProposals validates merge target level before using it as a parent, falls back to creation on mismatch
- Existing integration test (smart-add-duplicate-outcomes.test.ts) continues to pass
- New test: cross-level match is rejected (e.g. proposed epic with same title as existing task does NOT produce a duplicate match)
- New test: merge with level-matched duplicates correctly merges fields and adds non-duplicate children under the right parent

---
