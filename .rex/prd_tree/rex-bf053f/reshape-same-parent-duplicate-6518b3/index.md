---
id: "6518b3be-eda4-4f06-9d78-1b592049ce4a"
level: "feature"
title: "Reshape Same-Parent Duplicate Merge with Backup Audit Trail"
status: "completed"
source: "smart-add"
startedAt: "2026-05-11T21:45:55.698Z"
completedAt: "2026-05-11T21:45:55.698Z"
endedAt: "2026-05-11T21:45:55.698Z"
acceptanceCriteria: []
description: "Extend ndx reshape so that within a single parent it merges duplicate epics/features/tasks (sibling-only — never across different parents), preferring the newer item's fields while preserving any non-empty fields the older item has that the newer one lacks. Every merge must record an audit trail capturing the merge reasoning, the discarded old item IDs, and the pre-reshape git commit hash so the operation is reversible."
---

## Children

| Title | Status |
|-------|--------|
| [Record pre-reshape commit and merge audit trail (reasoning + old IDs) in archive and CLI output](./record-pre-reshape-commit-and-b6aca9.md) | completed |
