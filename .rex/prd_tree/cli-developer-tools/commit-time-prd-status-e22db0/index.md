---
id: "e22db08b-4465-4fe8-ad4c-e9f99fc8b259"
level: "feature"
title: "Commit-Time PRD Status Transition Embedding"
status: "completed"
source: "smart-add"
startedAt: "2026-04-29T19:02:57.778Z"
completedAt: "2026-04-29T19:02:57.778Z"
endedAt: "2026-04-29T19:02:57.778Z"
acceptanceCriteria: []
description: "When hench finishes a task and commits, the commit message must encode the PRD status transition (e.g. `pending → completed`) for the affected item so the commit itself is the system of record for the status change. The folder-tree write that flips the status to completed must be staged into the same commit, ensuring that checking out the commit reproduces the completed PRD state."
---

## Children

| Title | Status |
|-------|--------|
| [Add structured PRD status transition trailer to commit messages](./add-structured-prd-status-1e6528.md) | completed |
| [Stage PRD status transition write into the same commit that completes the task](./stage-prd-status-transition-d1e0b4.md) | completed |
