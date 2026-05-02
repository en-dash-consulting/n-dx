---
id: "80cfba3f-f672-43c3-8fcf-00d416757319"
level: "task"
title: "Render new index.md schema in dashboard detail view"
status: "completed"
priority: "medium"
tags:
  - "web"
  - "ui"
  - "prd"
source: "smart-add"
startedAt: "2026-04-30T13:47:03.546Z"
completedAt: "2026-04-30T14:01:42.678Z"
endedAt: "2026-04-30T14:01:42.678Z"
resolutionType: "code-change"
resolutionDetail: "Implemented complete UI rendering of new index.md schema in dashboard detail view. Added server endpoint, markdown parser, UI components, styling, and tests. All acceptance criteria met: renders all sections (progress table sortable by title/status/lastUpdated, commits, changes, info, summary), graceful fallback for legacy content."
acceptanceCriteria:
  - "Detail panel renders all schema sections (completion table, commits, summary, change list, basic info)"
  - "Completion table is sortable by title, status, and last-updated"
  - "Commit hashes link to the configured git remote when one is set; fall back to plain text otherwise"
  - "Folders still using legacy `index.md` content render without errors (graceful fallback to raw markdown)"
  - "Visual regression coverage for the new detail panel layout"
description: "Update the web dashboard PRD detail panel to recognize the new `index.md` summary structure: render the completion table as a sortable table, the commit list as linked git refs (when available), the prose summary as markdown, and surface the basic-info block. Ensure backward compatibility for folders whose `index.md` has not yet been regenerated under the new schema."
---
