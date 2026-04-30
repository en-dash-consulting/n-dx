---
id: "80cfba3f-f672-43c3-8fcf-00d416757319"
level: task
title: "Render new index.md schema in dashboard detail view"
status: in_progress
priority: medium
tags:
  - "web"
  - "ui"
  - "prd"
source: "smart-add"
startedAt: "2026-04-30T13:47:03.546Z"
acceptanceCriteria:
  - "Detail panel renders all schema sections (completion table, commits, summary, change list, basic info)"
  - "Completion table is sortable by title, status, and last-updated"
  - "Commit hashes link to the configured git remote when one is set; fall back to plain text otherwise"
  - "Folders still using legacy `index.md` content render without errors (graceful fallback to raw markdown)"
  - "Visual regression coverage for the new detail panel layout"
description: "Update the web dashboard PRD detail panel to recognize the new `index.md` summary structure: render the completion table as a sortable table, the commit list as linked git refs (when available), the prose summary as markdown, and surface the basic-info block. Ensure backward compatibility for folders whose `index.md` has not yet been regenerated under the new schema."
---

# Render new index.md schema in dashboard detail view

🟡 [in_progress]

## Summary

Update the web dashboard PRD detail panel to recognize the new `index.md` summary structure: render the completion table as a sortable table, the commit list as linked git refs (when available), the prose summary as markdown, and surface the basic-info block. Ensure backward compatibility for folders whose `index.md` has not yet been regenerated under the new schema.

## Info

- **Status:** in_progress
- **Priority:** medium
- **Tags:** web, ui, prd
- **Level:** task
- **Started:** 2026-04-30T13:47:03.546Z
