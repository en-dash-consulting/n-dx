---
id: "83a33c2a-31d7-4d71-95a3-246233fdc056"
level: "task"
title: "Direct Package Command Access"
status: "completed"
source: "smart-add"
startedAt: "2026-02-05T16:50:15.245Z"
completedAt: "2026-02-05T16:50:15.245Z"
description: "Allow users to run rex, sourcevision, and hench commands directly without the n-dx prefix\n\n---\n\nAllow users to use 'ndx' as an alternative to 'n-dx' for the main command"
---

## Subtask: Create standalone rex command

**ID:** `1c72464b-a642-46d4-be6d-f6757a37496e`
**Status:** completed
**Priority:** high

Add rex binary that directly invokes rex package commands

**Acceptance Criteria**

- rex status works without n-dx prefix
- All rex subcommands accessible directly
- Maintains same functionality as n-dx rex

---

## Subtask: Create standalone sourcevision command

**ID:** `85309262-fe76-4fe1-bd52-347fbefff59c`
**Status:** completed
**Priority:** high

Add sourcevision binary that directly invokes sourcevision package commands

**Acceptance Criteria**

- sourcevision analyze works without n-dx prefix
- All sourcevision subcommands accessible directly
- Maintains same functionality as n-dx sourcevision

---

## Subtask: Create standalone hench command

**ID:** `c4cef365-de7c-4c6c-a453-75b1ae90c215`
**Status:** completed
**Priority:** high

Add hench binary that directly invokes hench package commands

**Acceptance Criteria**

- hench run works without n-dx prefix
- All hench subcommands accessible directly
- Maintains same functionality as n-dx hench

---

## Subtask: Add ndx binary alias

**ID:** `0d0b108e-fb68-446c-a7d3-88a806eaacfe`
**Status:** completed
**Priority:** medium

Create ndx executable that delegates to n-dx CLI

**Acceptance Criteria**

- ndx command works identically to n-dx
- All subcommands work with ndx prefix
- Help text shows both ndx and n-dx as valid

---
