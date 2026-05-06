---
id: "48ac9b6e-974d-4224-9256-a130eb8b7510"
level: "task"
title: "Update CLAUDE.md, README, and folder-tree schema docs to reference .rex/prd_tree"
status: "completed"
priority: "medium"
tags:
  - "docs"
  - "rex"
source: "smart-add"
startedAt: "2026-05-06T13:23:32.163Z"
completedAt: "2026-05-06T13:26:47.975Z"
endedAt: "2026-05-06T13:26:47.975Z"
resolutionType: "acknowledgment"
resolutionDetail: "Verified that all documentation files (CLAUDE.md, AGENTS.md, package READMEs, prd-folder-tree-schema.md) already reference .rex/prd_tree exclusively. Confirmed no legacy .rex/tree documentation references remain. Validated that ndx init regeneration produces matching CLAUDE.md and AGENTS.md content by testing the renderClaudeMd() and renderAgentsMd() functions against the current files."
acceptanceCriteria:
  - "CLAUDE.md, AGENTS.md, package READMEs, and docs/architecture/prd-folder-tree-schema.md reference .rex/prd_tree exclusively"
  - "No documentation references to the legacy .rex/tree path remain except in a single migration/legacy note"
  - "ndx init regeneration produces matching AGENTS.md and CLAUDE.md content"
description: "Refresh all project documentation (CLAUDE.md Key Files table, PRD invariant note, folder-tree schema doc, package READMEs, assistant-assets project-guidance.md) to use the new .rex/prd_tree path. Regenerate AGENTS.md and CLAUDE.md from assistant-assets so both assistant surfaces stay aligned."
---

# Update CLAUDE.md, README, and folder-tree schema docs to reference .rex/prd_tree

🟡 [completed]

## Summary

Refresh all project documentation (CLAUDE.md Key Files table, PRD invariant note, folder-tree schema doc, package READMEs, assistant-assets project-guidance.md) to use the new .rex/prd_tree path. Regenerate AGENTS.md and CLAUDE.md from assistant-assets so both assistant surfaces stay aligned.

## Info

- **Status:** completed
- **Priority:** medium
- **Tags:** docs, rex
- **Level:** task
- **Started:** 2026-05-06T13:23:32.163Z
- **Completed:** 2026-05-06T13:26:47.975Z
- **Duration:** 3m
