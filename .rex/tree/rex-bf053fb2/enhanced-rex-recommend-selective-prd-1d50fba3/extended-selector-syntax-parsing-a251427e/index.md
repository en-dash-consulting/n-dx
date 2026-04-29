---
id: "a251427e-a782-4ec2-86f3-85e3cf42df72"
level: "task"
title: "Extended Selector Syntax Parsing"
status: "completed"
source: "smart-add"
startedAt: "2026-02-25T15:28:31.160Z"
completedAt: "2026-02-25T15:28:31.160Z"
acceptanceCriteria: []
description: "Extend the existing equals-prefixed index selector to support comma-separated lists and period wildcard for all items"
---

## Subtask: Implement comma-separated index list parsing for recommend --accept

**ID:** `3a435965-821f-4604-b120-c708ae290fb9`
**Status:** completed
**Priority:** high

Extend the existing `=index` syntax to support `=1,3,5` format for selecting multiple specific recommendations by index

**Acceptance Criteria**

- Parses `--accept=1,3,5` to select recommendations at indices 1, 3, and 5
- Validates all indices are within bounds of available recommendations
- Returns meaningful error for invalid index formats or out-of-range indices

---

## Subtask: Implement period wildcard syntax for accepting all recommendations

**ID:** `962251f0-fe07-4e26-a043-25469341d9ca`
**Status:** completed
**Priority:** high

Add support for `=.` syntax to accept all available recommendations at once without listing individual indices

**Acceptance Criteria**

- Parses `--accept=.` to select all available recommendations
- Works correctly when no recommendations are available (no-op behavior)
- Provides clear confirmation message showing total count of selected items

---
