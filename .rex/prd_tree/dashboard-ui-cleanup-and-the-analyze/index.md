---
id: "914926bd-5850-4e13-89e6-36543df881d1"
level: "epic"
title: "Dashboard UI cleanup and the Analyze page as a tile dashboard"
status: "completed"
priority: "high"
tags:
  - "web"
  - "viewer"
  - "ui"
source: "ndx-capture"
startedAt: "2026-10-15T04:30:08.880Z"
completedAt: "2026-10-15T14:52:06.923Z"
endedAt: "2026-10-15T14:52:06.923Z"
acceptanceCriteria:
  - "The three polish issues are fixed (bullets, floating pills, archetype/select controls)."
  - "The Analyze page renders as a tile grid with the iso map as the hero tile, a summary on each tile, in-place and full-screen expansion, and a PRD-item split in full-screen."
  - "A patch changeset for @n-dx/web describes the change."
description: "User review of the dashboard (2026-10-14): small polish issues (stray bullets on findings, overlapping floating status pills, archetype cells that look like native buttons, select arrows with no right padding) and a redesign of the Analyze page into a tile dashboard.\n\nAnalyze dashboard decisions (user, 2026-10-14):\n- Tiles show a purpose-built summary (\"glimpse\") per view; expanding shows the real view.\n- Two-level expand: click expands a tile in place to full grid width; a full-screen control opens it full-screen. Full-screen splits with the open PRD item detail as a right sidebar when one is open.\n- The isometric map is the hero tile across the top row(s).\n- The Terrain group goes. Zones becomes its own tile; the flat Graph view is dropped from the Analyze page (its /graph route stays).\n- Analyze only in this branch; build the grid as a reusable layout so Plan and Work can follow.\n\nConventions: branch `feat/dashboard-ui-cleanup`, stacked on `fix/sourcevision-csharp-and-ignore` (PR #746); PR base is that branch. Scoped tests: `pnpm --filter @n-dx/web exec vitest run <file>`. One patch changeset for `@n-dx/web`, written in the last task."
lastModified: "2026-10-15T14:52:07.208Z"
lastModifiedBy: "Nick Daniel <nick@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [A full-screen tile splits with the open PRD item as a sidebar](./a-full-screen-tile-splits-with-the.md) | completed |
| [An opened tile is a closeable modal with a way back, and the tile has two modes only](./an-opened-tile-is-a-closeable-modal.md) | completed |
| [Analysis header is one tidy block: status line under the title, a single split Re-analyze control, no emoji or raw checkbox](./analysis-header-is-one-tidy-block.md) | completed |
| [Analyze dashboard reworked per review: map in the top rows, aligned rows, one action per tile](./analyze-dashboard-reworked-per-review.md) | completed |
| [Analyze page renders as a tile dashboard with the iso map as hero](./analyze-page-renders-as-a-tile.md) | completed |
| [Analyze tiles show a purpose-built summary before they are expanded](./analyze-tiles-show-a-purpose-built.md) | completed |
| [Archetype cells and select controls look like styled selects, with room for the arrow](./archetype-cells-and-select-controls.md) | completed |
| [Breadcrumb removed; hub, project and branch switchers live in the top bar](./breadcrumb-removed-hub-project-and.md) | completed |
| [Changeset for the dashboard UI cleanup and Analyze tiles](./changeset-for-the-dashboard-ui-cleanup.md) | completed |
| [Codebase health tile has no misplaced or clipped info tips](./codebase-health-tile-has-no-misplaced.md) | completed |
| [Codebase map Expand opens the tile modal, not browser full screen](./codebase-map-expand-opens-the-tile.md) | completed |
| [Findings list items have no stray list bullets](./findings-list-items-have-no-stray-list.md) | completed |
| [Floating status pills share one dock instead of overlapping](./floating-status-pills-share-one-dock.md) | completed |
| [Isometric map zooms faster on a trackpad pinch and a little faster on ⌘/Ctrl + scroll](./isometric-map-zooms-faster-on-a.md) | completed |
| [Languages tile opens to a full breakdown, and languages get their own colours](./languages-tile-opens-to-a-full.md) | completed |
| [Opened Codebase health is actionable: stats lead to their tiles, and zones, cycles and hubs are listed and clickable](./opened-codebase-health-is-actionable.md) | completed |
| [Reusable dashboard tile grid with in-place and full-screen expansion](./reusable-dashboard-tile-grid-with-in.md) | completed |
