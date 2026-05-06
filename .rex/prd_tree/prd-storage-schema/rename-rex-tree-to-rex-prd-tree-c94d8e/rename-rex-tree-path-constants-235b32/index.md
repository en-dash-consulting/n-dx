---
id: "235b322d-5e4d-4160-b09b-f5a501cebc00"
level: "task"
title: "Rename .rex/tree path constants and update all serializer/parser/store call sites"
status: "completed"
priority: "high"
tags:
  - "rex"
  - "prd"
  - "storage"
  - "migration"
source: "smart-add"
startedAt: "2026-05-06T02:56:06.092Z"
completedAt: "2026-05-06T03:02:33.473Z"
endedAt: "2026-05-06T03:02:33.473Z"
resolutionType: "code-change"
resolutionDetail: "All acceptance criteria already met in codebase; added missing integration tests."
acceptanceCriteria:
  - "Single shared constant defines the prd_tree directory name; no hardcoded '.rex/tree' strings remain in production code"
  - "All PRD reads and writes (CLI, MCP, web server, hench gateway) target .rex/prd_tree"
  - "Projects with an existing .rex/tree directory are auto-renamed to .rex/prd_tree on the first PRD-touching command, preserving all item content and slugs"
  - "Unit and integration tests cover both the rename path and a fresh-init path that creates .rex/prd_tree directly"
description: "Update the canonical folder-tree directory constant from '.rex/tree' to '.rex/prd_tree' in PRDStore, the folder-tree serializer/parser, and every CLI/MCP/web read or write that references the old path. Add a one-time auto-rename on startup so existing projects with .rex/tree migrate transparently to .rex/prd_tree without data loss."
---

# Rename .rex/tree path constants and update all serializer/parser/store call sites

🟠 [completed]

## Summary

Update the canonical folder-tree directory constant from '.rex/tree' to '.rex/prd_tree' in PRDStore, the folder-tree serializer/parser, and every CLI/MCP/web read or write that references the old path. Add a one-time auto-rename on startup so existing projects with .rex/tree migrate transparently to .rex/prd_tree without data loss.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** rex, prd, storage, migration
- **Level:** task
- **Started:** 2026-05-06T02:56:06.092Z
- **Completed:** 2026-05-06T03:02:33.473Z
- **Duration:** 6m
