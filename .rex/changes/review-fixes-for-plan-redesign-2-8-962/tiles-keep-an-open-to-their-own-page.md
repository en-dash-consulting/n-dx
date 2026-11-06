---
id: "8cdee1e7-fc40-4655-9038-9566eb62f673"
type: "task"
title: "Tiles keep an Open ↗ to their own page"
slug: "tiles-keep-an-open-to-their-own-page"
description: "Stack review finding on #962 at docs/packages/web.md:7 (review comment 4488636763).\n\n**Should fix: docs, guide and changeset promise an \"Open ↗\" that tiles don't have**\n\nThis line says \"**Open ↗** goes to the tile's own page\", and `guide.ts:37` and the changeset say the same. Nothing in `stage-tiles.ts` provides it. The tile header is a single button that opens the modal (`stage-tile-open` is an `aria-hidden` expand icon), and `FullScreenTile` has only the back trail and Close. The old Plan sections had a `.stage-section-open` that called `navigateTo(view)`, and this PR deletes its test (\"opens a section's view on its own page\"). Plan can no longer reach `/changes`, `/product` or `/validation` as pages; the only Open ↗ left is the Inbox preview's `N more · Open ↗`, which shows only past five rows. No later PR adds one.\n\nFix: add an Open ↗ to the tile header or the full-screen modal that calls `navigateTo(tile.view)`, or correct all three texts. `docs/guide/change-management.md:42` still says \"the Inbox section on Plan\" too."
acceptanceCriteria:
  - "The tile header or its full-screen modal has an Open ↗ that calls navigateTo(tile.view), so Plan reaches /changes, /product and /validation again"
  - "A test clicks a tile's Open ↗ and asserts navigateTo is called with the tile's view"
  - "docs/guide/change-management.md no longer says 'the Inbox section on Plan'"
---
