---
id: "7834908d-fabe-4ecd-8784-058f7d0140f0"
level: "task"
title: "Rex Task Search"
status: "completed"
source: "smart-add"
startedAt: "2026-03-06T17:05:15.123Z"
completedAt: "2026-03-06T17:05:15.123Z"
description: "Add search functionality to the Rex tasks web UI so users can quickly locate tasks, epics, and features by title, description, tags, or status without manually scanning the full PRD tree."
---

## Subtask: Implement task search input and filtering engine in Rex UI

**ID:** `b9306df2-f2dd-4ec1-bf7a-3125f20436f7`
**Status:** completed
**Priority:** high

Add a search input to the Rex dashboard that filters the visible PRD tree in real time. The filtering engine should match against task/feature/epic titles and descriptions using case-insensitive substring matching, keeping matching ancestors visible to preserve tree context. Results should highlight matched text and auto-expand collapsed sections that contain matches.

**Acceptance Criteria**

- Search input is visible and focused on keyboard shortcut (e.g. Ctrl+F / Cmd+F or a dedicated keybinding)
- Typing in the search input filters the PRD tree to show only items whose title or description contains the query (case-insensitive)
- Ancestor nodes (epics, features) of matching tasks remain visible to provide tree context
- Matched text is visually highlighted within each result
- Sections containing matches are automatically expanded
- Clearing the search input restores the full unfiltered tree
- Search state is not persisted across page reloads

---

## Subtask: Extend Rex task search with tag and status facets

**ID:** `7084652c-0887-47fc-94b8-ab5e1536ea0b`
**Status:** completed
**Priority:** medium

Augment the basic title/description search with filter chips for tags and status values. Users should be able to combine a text query with one or more tag or status facets to narrow results further. Facets should be populated dynamically from the current PRD data.

**Acceptance Criteria**

- Tag facet chips are rendered below the search input, populated from all unique tags present in the PRD
- Status facet chips (todo, in-progress, completed, blocked, deferred) are available as toggleable filters
- Selecting a tag or status facet further narrows the already-filtered tree
- Multiple facets can be active simultaneously (AND logic within each facet group)
- Active facets are visually distinguished from inactive ones
- Clearing all facets and the search input returns the full tree
- Facet state updates the URL hash or query string so the filtered view is shareable

---

## Subtask: Limit tag filter options in Rex task search to tags present in the current PRD

**ID:** `6b7536e1-7c34-4906-be43-74e715c267dc`
**Status:** completed
**Priority:** medium

The tag facet selector in the Rex task search area currently shows an unbounded or static list of tag options. It should instead derive its options dynamically from the set of tags actually used across all tasks in the current PRD tree, so users only see relevant, actionable choices. Tags with zero matching tasks in the current view should be omitted or visually disabled.

**Acceptance Criteria**

- Tag options in the search facet are derived at runtime from tags present on tasks in the loaded PRD
- Tags not present on any task in the current PRD do not appear as selectable options
- Tag list updates if the PRD is refreshed or tasks are added/removed during the session
- Selecting a tag filter correctly narrows the displayed task list to tasks carrying that tag
- Empty-state messaging is shown when no tags exist in the current PRD

---
