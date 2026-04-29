---
id: "6f927f1f-811b-4eb3-a269-0bae5edd8017"
level: "task"
title: "Scanner improvements"
status: "completed"
source: "llm"
startedAt: "2026-02-24T20:33:37.695Z"
completedAt: "2026-02-24T20:33:37.695Z"
acceptanceCriteria: []
description: "Enhance individual scanners to produce better quality analysis results"
---

## Subtask: Filter auto-generated files from scanDocs

**ID:** `9a7d6848-2054-47d4-9d10-e5bd144939e9`
**Status:** completed
**Priority:** medium

Ignore files in dist/, .sourcevision/ and other generated directories

**Acceptance Criteria**

- Skips known generated directories
- Configurable ignore patterns
- Focuses on human-written docs

---

## Subtask: Enhance scanSourceVision output

**ID:** `dbcbbb03-7c1d-4d45-8764-abf7711fb87e`
**Status:** completed
**Priority:** medium

Produce more actionable tasks from zone findings with file paths

**Acceptance Criteria**

- Includes specific file paths
- Suggests concrete fixes
- More actionable task descriptions

---

## Subtask: Add scanPackageJson scanner

**ID:** `0cf5900a-dbac-4146-b0ac-880f19523d52`
**Status:** completed
**Priority:** low

Extract scripts, dependencies, and engine requirements as tasks

**Acceptance Criteria**

- Parses package.json files
- Identifies scripts as potential tasks
- Checks dependency updates
- Notes engine requirements

---

## Subtask: Improve scanDocs: numbered lists, clean headings, skip code blocks

**ID:** `05e9ee30-c4ab-43cb-8718-cccd4f648b6d`
**Status:** completed
**Priority:** medium

---
