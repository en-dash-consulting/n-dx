---
id: "4f0263fa-8da5-4a83-811c-01da1c4acdf7"
level: "task"
title: "Implement cross-PRD duplicate detection with merge-into-older-file resolution"
status: "completed"
priority: "high"
tags:
  - "rex"
  - "smart-add"
  - "dedup"
source: "smart-add"
startedAt: "2026-04-22T18:34:12.341Z"
completedAt: "2026-04-22T18:57:05.754Z"
resolutionType: "code-change"
resolutionDetail: "Cross-PRD duplicate detection with older-file preference via ItemFileMap and comparePRDFileAge"
acceptanceCriteria:
  - "Duplicate detection scans items across all prd_*.json files, not just the current branch's file"
  - "When a duplicate is detected, the older PRD file is identified by comparing creation dates from filenames"
  - "Merge writes the updated item to the older PRD file, not the current branch's file"
  - "Merge preserves existing acceptance criteria, tags, and metadata from the older item while incorporating new content"
  - "Non-duplicate proposals are added to the current branch's PRD file as normal"
description: "Extend the existing smart-add duplicate matching to compare proposals against items in all PRD files. When a duplicate is found, determine which PRD file contains the older item (by file creation date from filename) and merge the newer proposal's content into that older item rather than creating a new entry in the current branch's PRD."
---
