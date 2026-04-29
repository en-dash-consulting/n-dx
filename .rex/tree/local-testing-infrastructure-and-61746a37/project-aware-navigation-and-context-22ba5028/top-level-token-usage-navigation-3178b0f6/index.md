---
id: "3178b0f6-1253-4593-a666-f086262c5395"
level: "task"
title: "Top-level Token Usage Navigation"
status: "completed"
source: "smart-add"
startedAt: "2026-02-22T19:54:30.379Z"
completedAt: "2026-02-22T19:54:30.379Z"
acceptanceCriteria: []
description: "Expose Token Usage as a first-class dashboard destination at the same hierarchy level as Settings without breaking existing navigation contracts."
---

## Subtask: Add Token Usage as a peer top-level nav item to Settings

**ID:** `1a210c52-c5a6-4c25-9f62-6cc0baa4dda5`
**Status:** completed
**Priority:** high

Users need direct access to utilization analytics from primary navigation rather than discovering it inside Rex-specific views; this change improves findability and reinforces Token Usage as a cross-tool concern.

**Acceptance Criteria**

- Main dashboard navigation renders a Token Usage item at the same hierarchy level as Settings
- Selecting Token Usage loads the existing Token Usage view content without regressions in data rendering
- Navigation ordering and visibility are deterministic across page reloads

---

## Subtask: Preserve legacy deep links by routing old Token Usage URLs to the new top-level destination

**ID:** `94bfe253-17d5-475a-bb3a-c30b96401de1`
**Status:** completed
**Priority:** critical

Existing bookmarks and shared links must continue working so teams do not lose access patterns after the navigation restructure.

**Acceptance Criteria**

- Legacy Token Usage route patterns resolve to the new top-level Token Usage destination
- URL normalization preserves query params and hash fragments used by existing links
- No 404 or blank-state regressions occur when opening previously valid deep links

---

## Subtask: Align active-state highlighting with normalized Token Usage routes

**ID:** `60cb5125-0023-4f3f-a508-2c10ced263ad`
**Status:** completed
**Priority:** high

Active-state logic must remain trustworthy after route remapping so users always see accurate location context in navigation.

**Acceptance Criteria**

- Token Usage nav item is highlighted for both new and legacy-normalized Token Usage URLs
- Settings and other top-level items are not highlighted when Token Usage is active
- Automated tests cover active-state behavior for direct load, in-app navigation, and legacy deep-link entry

---
