---
id: "98e69d5c-e589-45fa-8e3d-5af4211d8906"
level: "task"
title: "JSON-based branch work tracking infrastructure"
status: "completed"
source: "smart-add"
startedAt: "2026-02-25T04:30:49.301Z"
completedAt: "2026-02-25T04:30:49.301Z"
description: "Create a persistent JSON-based system within sourcevision to track completed epics, features, and tasks on the current branch"
---

## Subtask: Implement branch work record JSON schema and storage

**ID:** `d1389dda-9ce8-43b8-86cc-dcafd5ce7287`
**Status:** completed
**Priority:** high

Define a JSON schema for tracking branch-specific work completion and implement file-based storage within the sourcevision package directory structure

**Acceptance Criteria**

- JSON schema includes epic/feature/task hierarchy with completion timestamps
- Schema supports metadata fields for change significance and breaking change flags
- File is stored within .sourcevision/ directory with branch-specific naming
- Schema validation prevents malformed records

---

## Subtask: Create branch work collector service

**ID:** `39e39bf0-e71d-4869-9a0a-78d3dc86d01f`
**Status:** completed
**Priority:** high

Build a service that queries rex PRD data to identify completed work items associated with the current branch and populates the branch work record

**Acceptance Criteria**

- Service correctly identifies branch-specific completed rex items
- Collector handles epic/feature/task hierarchy traversal
- Service excludes work items not relevant to current branch
- Collector gracefully handles missing or corrupted rex data

---

## Subtask: Implement change significance classification

**ID:** `5c55bb68-c312-42b3-99cc-b45e409a85ca`
**Status:** completed
**Priority:** medium

Add logic to classify completed work items by significance level (major changes, breaking changes, important functions) based on rex metadata and task descriptions

**Acceptance Criteria**

- Breaking change detection from rex task tags and descriptions
- Major change identification based on epic scope and task count
- Important function classification from task acceptance criteria
- Classification results persisted in branch work record

---
