---
id: "61610675-8986-4ee5-8731-8a41f3e9fa7d"
type: "change"
title: "Describe-a-change gets its own pane, and More opens a modal"
slug: "describe-a-change-gets-its-own-pane"
summary: "The box for describing a new change moves out of the top of the Plan page into its own panel, and its 'More' option opens a tidy pop-up instead of an awkward inline section. Capturing ideas feels deliberate and uncluttered."
intent: "Today the Plan page's capture bar ('Describe a change for the Inbox…', smart-add-input.ts in bar mode) sits across the top, and its More toggle expands an inline section that reads as sloppy. Move capture into its own Plan tile (through StageDef.tiles like the other Plan tiles) and make More open a closeable modal containing the full form (description, attachments, preview). Keyboard: Escape closes, focus returns to the More button. The existing capture behaviour (Inbox target, image attachments, preview) is unchanged."
acceptanceCriteria:
  - "The describe-a-change input renders in its own Plan tile, not as a bar across the top of the page"
  - "Clicking More opens a modal dialog with the full capture form instead of expanding an inline section"
  - "The modal closes on Escape, on its close button and on backdrop click, and returns focus to the More button"
  - "Capturing from the tile and from the modal still creates an Inbox change with attachments and preview as before"
  - "Existing smart-add tests pass and new tests cover the tile placement and modal open/close"
touches:
  - "89ecd7f3-ca6a-4833-90a4-7bc7b1017e94"
priority: "medium"
tags:
  - "web"
  - "plan"
  - "ux"
source: "ndx-capture"
---
