---
id: "1b9353a7-41d8-4f55-947c-1aedaadc5932"
level: "task"
title: "Sidebar Active State on Initial Load"
status: "completed"
source: "smart-add"
startedAt: "2026-03-06T07:54:44.479Z"
completedAt: "2026-03-06T07:54:44.479Z"
description: "Ensure the sidebar navigation correctly reflects the active page when the app first loads, including direct URL access and page refresh scenarios.\n\n---\n\nClarify the dual-FAB FAQ pattern by anchoring the global FAQ FAB in the bottom-left toolbar alongside the theme switcher, while leaving the page-specific FAQ FAB in its existing top-right position. This gives each button a distinct visual location that communicates its scope to the user."
---

## Subtask: Sync sidebar active state with current route on initial page load

**ID:** `5a83f70a-b30d-4251-8168-5e8d939f9b1d`
**Status:** completed
**Priority:** medium

When the web UI loads or is refreshed, the sidebar should immediately highlight the nav item corresponding to the current URL hash or route, rather than defaulting to no selection or the wrong item. This involves reading the initial route from the URL at mount time and applying the active state before the first render.

**Acceptance Criteria**

- Loading the app at any valid route URL shows the correct sidebar item highlighted on first render
- Refreshing the page on any view retains the correct active sidebar item
- Direct URL navigation (e.g. pasting a deep link) highlights the matching sidebar item
- No visible flash of incorrect or missing active state on load

---

## Subtask: Relocate global FAQ FAB to bottom-left toolbar beside theme switcher

**ID:** `3560e79d-0a36-4ce6-949d-5834403e5f2c`
**Status:** completed
**Priority:** low

Move the global FAQ floating action button out of its current position and into the bottom-left corner of the UI, directly adjacent to the existing theme switcher control. The page-specific FAQ FAB must remain in the top-right and must not be affected by this change. Update any positioning styles, z-index stacking, and layout containers that govern the bottom-left toolbar so the two controls sit flush without overlap.

**Acceptance Criteria**

- Global FAQ FAB renders in the bottom-left corner of the viewport at all supported viewport widths
- Global FAQ FAB is visually adjacent to the theme switcher with consistent spacing matching the design system
- Page-specific FAQ FAB remains in the top-right corner and is visually and functionally unchanged
- No overlap or collision between the global FAQ FAB and theme switcher at narrow viewport widths
- Both FABs remain accessible (keyboard-focusable, correct aria-label) after the move
- Existing FAQ FAB click handlers and modal/panel behavior are preserved

---
