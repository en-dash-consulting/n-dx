---
id: "dc8fd7bb-c902-4a61-931b-0a91a1d7fe0a"
level: "task"
title: "File import enhancements"
status: "completed"
source: "llm"
startedAt: "2026-02-24T20:33:37.695Z"
completedAt: "2026-02-24T20:33:37.695Z"
acceptanceCriteria: []
description: "Improve file-based import functionality for better flexibility"
---

## Subtask: Support multiple input files

**ID:** `45a448f5-95b5-46bf-a32e-490181ccd56e`
**Status:** completed
**Priority:** low

Allow multiple --file flags in rex analyze command

**Acceptance Criteria**

- Accepts multiple --file parameters
- Processes all files together
- Combines results coherently

---

## Subtask: Add JSON and YAML import support

**ID:** `22f4144a-0ec1-4c19-8ce4-fa3a8fa294dc`
**Status:** completed
**Priority:** low

Support additional file formats beyond markdown

**Acceptance Criteria**

- Detects format by extension
- Parses JSON input files
- Parses YAML input files
- Maintains markdown support

---

## Subtask: Show import diff before accepting

**ID:** `f5f4259c-8a98-4295-89e6-5f3870464d7a`
**Status:** completed
**Priority:** medium

Display changes against existing PRD before importing

**Acceptance Criteria**

- Shows what will be added
- Shows what will be changed
- User approval before applying

---
