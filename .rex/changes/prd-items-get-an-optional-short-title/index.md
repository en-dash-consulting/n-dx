---
id: "87627ce2-d130-493b-9ad7-515cd65fc86a"
type: "change"
title: "PRD items get an optional short title, unique among open items"
slug: "prd-items-get-an-optional-short-title"
summary: "Each piece of work can have an optional short name that the dashboard shows instead of its long title. No two open items can share a name, but finished work can be reused, so updates to old work read naturally."
intent: "Titles shown in the UI are often long. Add an optional short title to every PRD item (change, task, subtask; v1 levels too), stored in the item's intent. Every UI surface that shows an item's name uses the short title and falls back to the full title. The name the UI shows (short title, else title) must be unique among open items: pending, in_progress, blocked or deferred. Completed items may share it, so updates to finished work can reuse a name. add_item, edit_item, the rex CLI and dashboard edits refuse a short title that collides with an open item and name the colliding item. The full title stays available (detail panel, tooltip)."
acceptanceCriteria:
  - "Every PRD item can carry an optional short title, stored and round-tripped by the v1 and v2 stores"
  - "The short title can be set and cleared from the dashboard, the rex CLI and the rex MCP add_item and edit_item tools"
  - "Dashboard surfaces that show an item's name use the short title and fall back to the full title"
  - "The full title stays visible in the item detail panel and as a tooltip where the short title is shown"
  - "Setting a short title that matches the shown name of another open item (pending, in_progress, blocked or deferred) is refused with an error naming that item"
  - "A short title that matches only completed items is accepted"
  - "Unit tests cover the fallback, the uniqueness check and the completed-item exemption"
touches:
  - "2171d478-2d5b-4926-8e85-837f52c99abd"
priority: "medium"
tags:
  - "rex"
  - "web"
  - "schema"
source: "ndx-capture"
---
