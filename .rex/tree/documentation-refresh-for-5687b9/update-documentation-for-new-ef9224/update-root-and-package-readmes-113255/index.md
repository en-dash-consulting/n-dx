---
id: "1132550d-e4dc-4103-b86a-c849b46d60f5"
level: "task"
title: "Update root and package READMEs for new PRD structure and recent merges"
status: "completed"
priority: "high"
tags:
  - "documentation"
  - "readme"
source: "smart-add"
startedAt: "2026-04-23T03:02:59.730Z"
completedAt: "2026-04-23T03:06:08.854Z"
resolutionType: "code-change"
resolutionDetail: "Added legacy-migration note to README.md §Output Files and packages/rex/README.md §Project structure (new §PRD file layout subsection with before/after file tree). Other package READMEs already match current single-file PRD behavior — no edits needed for PRD scope."
acceptanceCriteria:
  - "All README files referencing .rex/prd.json describe the multi-file format accurately"
  - "Migration behavior from single prd.json to branch-scoped format is documented with before/after file layout"
  - "Cross-PRD duplicate detection is described where add/recommend workflows are documented"
  - "CLI examples and command output in READMEs match current behavior for ndx add, rex add, and related commands"
  - "No broken cross-references between READMEs remain after edits"
description: "Revise README.md, packages/rex/README.md, packages/core/README.md, and any other package READMEs that reference .rex/prd.json or PRD workflow to reflect the branch-scoped multi-file PRD format, the migration path from single-file prd.json, cross-PRD duplicate detection behavior, and any CLI/MCP surface changes from recent merges. Replace outdated examples and command output snippets where the behavior has changed."
---

# Update root and package READMEs for new PRD structure and recent merges

🟠 [completed]

## Summary

Revise README.md, packages/rex/README.md, packages/core/README.md, and any other package READMEs that reference .rex/prd.json or PRD workflow to reflect the branch-scoped multi-file PRD format, the migration path from single-file prd.json, cross-PRD duplicate detection behavior, and any CLI/MCP surface changes from recent merges. Replace outdated examples and command output snippets where the behavior has changed.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** documentation, readme
- **Level:** task
- **Started:** 2026-04-23T03:02:59.730Z
- **Completed:** 2026-04-23T03:06:08.854Z
- **Duration:** 3m
