---
id: "3e493079-5986-4fa7-875f-9dc6879183af"
level: "task"
title: "Zone Architecture Enhancement"
status: "completed"
source: "llm"
startedAt: "2026-02-09T15:12:52.695Z"
completedAt: "2026-02-09T15:12:52.695Z"
description: "Improve zone-based code organization and reduce coupling"
---

## Subtask: Extract shared types to break circular dependencies

**ID:** `bc578874-916e-4148-b3de-84ddba2fbd54`
**Status:** completed
**Priority:** high

Create packages/hench/src/types/index.ts with shared interfaces like RunContext and ToolResult, then re-export from both CLI and core modules

**Acceptance Criteria**

- Shared types module created with RunContext and ToolResult interfaces
- Bidirectional imports between CLI and core are eliminated
- All existing functionality preserved after refactor

---

## Subtask: Split Hench zone into focused modules

**ID:** `2f741c6f-0af4-42cc-9bd4-84ec00aed789`
**Status:** completed
**Priority:** high

Split the 32-file Hench 2 zone into hench-core (run loop, context) and hench-tooling (tool definitions, execution) for better separation of concerns

**Acceptance Criteria**

- Hench-core module contains run loop and context management
- Hench-tooling module contains tool definitions and execution
- Each module has clear responsibilities and minimal coupling

---

## Subtask: Reorganize agent directory structure

**ID:** `471ba9ad-3e03-4c07-a3a9-06bc25d8e148`
**Status:** completed
**Priority:** medium

Split agent/ into lifecycle (loop, cli-loop), planning (brief, prompt), and analysis (review, summary, stuck) subdirectories for better organization

**Acceptance Criteria**

- Agent directory split into logical subdirectories
- All imports updated to reflect new structure
- No functionality broken by reorganization

---

## Subtask: Audit command parsing logic for duplication

**ID:** `43438e05-3a59-4719-94bf-363948ecdbb0`
**Status:** completed
**Priority:** medium

Review shell.ts and guard/commands.ts for duplicated command parsing and validation logic, consolidate where appropriate

**Acceptance Criteria**

- Duplicated command parsing logic identified
- Consolidated parsing logic where appropriate
- No functionality lost in consolidation

---

## Subtask: Integrate ci.js into main orchestration flow

**ID:** `08356c3f-deb5-4131-a0ad-327522d2e3ab`
**Status:** completed
**Priority:** medium

Verify if ci.js should be documented separately or wired into cli.js as part of the main orchestration flow

**Acceptance Criteria**

- ci.js integration status clarified
- Either properly integrated into cli.js or documented as standalone
- No orphaned functionality in codebase

---
