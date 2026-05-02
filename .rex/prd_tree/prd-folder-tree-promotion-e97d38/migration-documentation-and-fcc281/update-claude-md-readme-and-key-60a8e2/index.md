---
id: "60a8e23e-106e-4313-b253-612a55b65d27"
level: "task"
title: "Update CLAUDE.md, README, and Key Files documentation to reflect folder-tree as sole PRD storage"
status: "completed"
priority: "medium"
tags:
  - "documentation"
  - "prd"
source: "smart-add"
startedAt: "2026-04-29T18:21:59.248Z"
completedAt: "2026-04-29T18:28:26.072Z"
endedAt: "2026-04-29T18:28:26.072Z"
resolutionType: "code-change"
resolutionDetail: "Updated all documentation references across CLAUDE.md, AGENTS.md, README, assistant-assets (project-guidance.md, claude-addendum.md), and prd-folder-tree-schema.md to describe .rex/tree/ as the sole PRD storage format."
acceptanceCriteria:
  - "CLAUDE.md Key Files table lists .rex/prd/<epic-slug>/... as the primary PRD storage path"
  - "PRD invariant note updated to name the folder tree as the sole writable surface"
  - "Concurrency contract rows referencing prd.md writes updated to reference folder-tree mutation paths"
  - "README quick start and workflow sections do not mention prd.md as a user-facing file"
  - "docs/architecture/prd-folder-tree-schema.md updated with slug naming convention and examples"
description: "Revise all documentation references that describe prd.md or branch-scoped prd_{branch}_{date}.md files as primary writable PRD surfaces. Update the Key Files table, PRD file layout note, PRD invariant, concurrency contract, and README workflow sections to describe the slug-based folder tree as the only authoritative format."
---

# Update CLAUDE.md, README, and Key Files documentation to reflect folder-tree as sole PRD storage

🟡 [completed]

## Summary

Revise all documentation references that describe prd.md or branch-scoped prd_{branch}_{date}.md files as primary writable PRD surfaces. Update the Key Files table, PRD file layout note, PRD invariant, concurrency contract, and README workflow sections to describe the slug-based folder tree as the only authoritative format.

## Info

- **Status:** completed
- **Priority:** medium
- **Tags:** documentation, prd
- **Level:** task
- **Started:** 2026-04-29T18:21:59.248Z
- **Completed:** 2026-04-29T18:28:26.072Z
- **Duration:** 6m
