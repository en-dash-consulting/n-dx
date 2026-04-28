---
id: "4c522dcd-db15-4f2e-a108-d98619be078a"
level: "task"
title: "Bulk natural language input"
status: "completed"
source: "llm"
startedAt: "2026-02-24T20:33:37.695Z"
completedAt: "2026-02-24T20:33:37.695Z"
description: "Support multiple descriptions and file-based input for batch PRD creation"
---

## Subtask: Support multiple descriptions in single command

**ID:** `0a24b5bd-fa59-41c0-b9ac-9bfd85eca54e`
**Status:** completed
**Priority:** medium

Accept multiple natural language descriptions in one rex add call

**Acceptance Criteria**

- Multiple descriptions can be passed as arguments
- Each description processed by LLM
- Results combined into coherent structure

---

## Subtask: Add piped input support

**ID:** `ed902797-9b9f-4181-9d88-cac559014a91`
**Status:** completed
**Priority:** low

Allow piping text into rex add command

**Acceptance Criteria**

- Accepts stdin input
- Processes piped text as description
- Works with echo and other pipe sources

---

## Subtask: Implement file-based idea import

**ID:** `6b968585-1368-40e3-aa65-b966148e5c91`
**Status:** completed
**Priority:** medium

Support --file flag to read freeform brainstorming notes

**Acceptance Criteria**

- Accepts --file parameter
- Reads freeform text files
- Structures all ideas at once via LLM
- Distinct from formal spec import

---
