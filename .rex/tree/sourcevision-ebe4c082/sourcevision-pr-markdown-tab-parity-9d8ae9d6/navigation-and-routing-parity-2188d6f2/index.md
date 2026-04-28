---
id: "2188d6f2-e783-4c7f-a0f9-5e1ba05ad4e7"
level: "task"
title: "Navigation and Routing Parity"
status: "completed"
source: "smart-add"
startedAt: "2026-02-21T06:15:07.728Z"
completedAt: "2026-02-21T06:15:07.728Z"
description: "Make PR Markdown behave identically to first-class SourceVision tabs so navigation, selection, and deep-link behavior are consistent."
---

## Subtask: Register PR Markdown in the shared SourceVision tab configuration

**ID:** `e8da0d59-e873-452d-931e-1128063df53f`
**Status:** completed
**Priority:** critical

Centralize PR Markdown in the same tab metadata structure used by Import Graph and Zones so sidebar rendering and view wiring are driven by one source of truth.

**Acceptance Criteria**

- PR Markdown appears in the SourceVision sidebar using the same tab component path as Import Graph and Zones
- Tab metadata for PR Markdown is defined in the shared SourceVision tab config rather than ad-hoc conditional rendering
- Selecting PR Markdown from the sidebar opens the PR Markdown view without requiring additional manual URL edits

---

## Subtask: Normalize PR Markdown hash route parsing and tab selection state

**ID:** `d1d4f0ea-6eb3-4393-8cce-6c3c583df572`
**Status:** completed
**Priority:** critical

Align PR Markdown route/hash handling with existing SourceVision views to prevent mismatches between URL, selected tab, and rendered content.

**Acceptance Criteria**

- Loading the PR Markdown hash directly selects the PR Markdown tab and renders the PR Markdown view
- Browser back/forward navigation updates both selected tab state and rendered panel correctly for PR Markdown
- Unknown or malformed PR Markdown hashes fall back to the default SourceVision view without crashing

---
