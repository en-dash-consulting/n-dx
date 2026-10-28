---
id: "8410008a-f016-4b58-90a5-c384bab02029"
type: "change"
title: "Changes view: the intent's more toggle runs into the Unplaced line"
slug: "changes-view-the-intent-s-more-toggle"
intent: "Found checking the #873 stack in the browser. In the Changes view, a change row whose intent is clamped renders the `more`/`less` toggle (`.ch-intent-toggle`, `views/changes.ts` around line 95) inline, directly followed by the row's map line (`.ch-map-none` \"Unplaced\", or its touches/amends line). With no break or gap between them the row reads \"moreUnplaced\".\n\nPut the toggle on its own line under the intent, or give the map line its own row, so the toggle and the map line never share a line. Styles are in `packages/web/src/viewer/styles/product.css` (`.ch-intent-toggle`, `.ch-map-none`)."
acceptanceCriteria:
  - "In a row with a clamped intent, the more/less toggle and the row's map line (Unplaced, or its touches/amends) never share a line"
  - "Rows with a short intent, which show no toggle, keep their current layout"
  - "A Changes view unit test fails if the toggle and the map line render on one line (for example, asserts they sit in separate block-level elements)"
touches:
  - "2e233c46-e4fb-49d1-81e7-6e0fd58fc683"
  - "e1a26302-7d80-46d4-9002-45e25119ba34"
priority: "low"
discoveredFrom: {"item":"9edad54b-76d5-402a-a6bc-67a77229b43c"}
tags:
  - "inbox-placement"
  - "web"
  - "layout"
source: "ndx-capture"
---
