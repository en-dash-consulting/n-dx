---
id: "d03c88c7-d038-46c6-899b-1c64daddb326"
type: "change"
title: "The search overlay and task links show raw labels for failing and cancelled items"
slug: "the-search-overlay-and-task-links-show"
intent: "packages/web/src/viewer/components/search-overlay.ts (~74) has no `cancelled` entry, so it shows the raw \"cancelled\"; components/rex-task-link.ts (~51) has no `failing` or `cancelled`, so a failing task shows ○ with the pending class and a raw label. The shared table is components/prd-tree/status-display.ts.\n\nReachable: yes, any failing or cancelled item in search results or task links.\n\nFix options: (1, recommended) read both from STATUS_DISPLAY; small, changes those two statuses' look on purpose.\n\nVerdict: out-of-scope for the streamline refactor stack (pre-existing, found by its adversarial review, 2026-11-15); worth fixing on its own."
acceptanceCriteria:
  - "Search results and task links show the shared glyph and label for failing and cancelled items"
  - "A component test renders each with failing and cancelled items and asserts the shared glyph and label"
touches:
  - "6eb227af-ffb2-4f39-8f62-d4afbad09a57"
priority: "low"
source: "ndx-adversarial-review"
---
