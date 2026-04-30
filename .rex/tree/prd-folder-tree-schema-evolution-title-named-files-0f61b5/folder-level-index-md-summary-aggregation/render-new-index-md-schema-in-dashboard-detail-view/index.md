---
id: "80cfba3f-f672-43c3-8fcf-00d416757319"
level: "task"
title: "Render new index.md schema in dashboard detail view"
status: "pending"
priority: "medium"
tags:
  - "web"
  - "ui"
  - "prd"
source: "smart-add"
acceptanceCriteria:
  - "Detail panel renders all schema sections (completion table, commits, summary, change list, basic info)"
  - "Completion table is sortable by title, status, and last-updated"
  - "Commit hashes link to the configured git remote when one is set; fall back to plain text otherwise"
  - "Folders still using legacy `index.md` content render without errors (graceful fallback to raw markdown)"
  - "Visual regression coverage for the new detail panel layout"
description: "Update the web dashboard PRD detail panel to recognize the new `index.md` summary structure: render the completion table as a sortable table, the commit list as linked git refs (when available), the prose summary as markdown, and surface the basic-info block. Ensure backward compatibility for folders whose `index.md` has not yet been regenerated under the new schema."
---
